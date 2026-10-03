// The island: DOM shell, sizing animation, Mochi placement, mouse handling.
// Mirrors IslandRootView.swift + IslandWindowController.swift.

import { Tracked, Spring, clamp } from "../core/anim";
import { Bridge, IS_TAURI, onDragDrop, onEvent, type DroppedFile } from "../core/bridge";
import {
  EXPANDED_CORNER, EXPANDED_W, NOTCH_TAB_CORNER, NOTCH_W, geo, onSide, type IslandLayout,
  ROUNDED_CORNER, VIEW_LAYOUTS, WAKE_STRIP_H, WAKE_STRIP_W, botGlowColor, botGlowOpacity, botPosition, chatPromptHeight,
  islandSize,
  type IslandMode, type IslandViewName, SIDE_COMPACT, COMPACT_W, NOTCH_H,} from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { BotEngine, hexToRGB } from "../mochi/engine";
import { Greeting } from "../mochi/greeting";
import { createMiniBot, pruneMiniBots, syncMiniBotStates, tickMiniBots } from "../mochi/minibots";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import { h } from "../views/dom";
import { IslandStateMachine } from "./fsm";
import { Mover, type Edge } from "./move";

const BOT_OVERHANG = 40;
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;

/** The three views the drop sequence owns; leaving them stops the engine. */
const UPLOAD_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading", "choose"]);

/** Seconds between the drop and the moment the progress bar starts filling. */
const PRE_PROGRESS = USC.T_PROG_START - USC.T_DROP;

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;
  private mover!: Mover;
  /** The drop page was opened by a drag coming near (notch-drag-near). */
  private dropWoke = false;
  /** Set while the island is being moved (move.ts). */
  private moveAt: { x: number; y: number; transform: string } | null = null;
  private resizeGrip!: HTMLElement;
  private resizing: { sx: number; sy: number; w: number; h: number } | null = null;
  private notchNub!: HTMLElement;

  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  private uploadCanvas!: UploadCanvas;

  private width = new Tracked(NOTCH_W);
  private height = new Tracked(0);
  private radius = new Tracked(ROUNDED_CORNER);
  private botCx = new Spring(46);
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine();
  private greeting = new Greeting();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;

  // Rust starts the window at full size so the launch greeting has room.
  private collapsed = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  /** Last shape handed to Rust for the click-through test. */
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };
  private homeCollapseAt: number | null = null;

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private botHoverStart = { x: 0, y: 0 };

  private confusedRecovery: number | null = null;
  private prevViewBeforeConfused: IslandViewName = "overview";
  private lastSyncedView: IslandViewName | null = null;

  /** Drop sequence bookkeeping: last tick played, and whether the ✓ has fired. */
  private uploadTens = 0;
  private uploadDone = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.wireFsm();
    this.mover = new Mover(
      {
        pillSize: (edge: Edge) =>
          edge === "left" || edge === "right" ? { ...SIDE_COMPACT } : { w: COMPACT_W, h: NOTCH_H },
        setMoveOverride: (at) => {
          this.moveAt = at;
          this.applyGeometry();
        },
        previewEdge: (edge: Edge) => {
          geo.layout = { ...geo.layout, edge, vertical: edge === "left" || edge === "right" };
          this.animateGeometry(false);
        },
        enterMove: () => {
          const saved = { wasExpanded: State.mode === "expanded", view: State.view };
          this.fsm.pinned = true;
          if (State.mode !== "compact") this.collapse();
          this.fsm.pinned = true;
          return saved;
        },
        leaveMove: (saved) => {
          this.fsm.pinned = State.isPinned;
          if (saved.wasExpanded) {
            this.fsm.forceHome();
            this.expand(saved.view as IslandViewName);
          }
        },
      },
      this.root,
    );
    this.wireInput();
    this.engine.onDizzy = () => this.handleDizzy();
    this.greeting.onComplete = () => this.fsm.greetComplete();
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
    });
    this.scheduleFidget();
  }

  /**
   * Every few seconds Awuuu does one small move (wag, ear flick, sniff…). The
   * move is a tween, so the frame loop wakes for ~1 s and stops again; while the
   * island is hidden the timer does nothing and no frame is drawn.
   */
  private scheduleFidget() {
    window.setTimeout(() => {
      if (State.mode !== "hidden" && !UploadSeq.isActive && this.engine.fidget()) {
        this.ensureRunning();
      }
      this.scheduleFidget();
    }, 4000 + Math.random() * 3000);
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const actions: ViewActions = {
      setView: (v) => this.setView(v),
      collapse: () => this.collapse(),
      setFocus: (id) => {
        State.setFocus(id);
        Sound.play("blip");
      },
      setAgentFocus: (id) => {
        State.setAgentFocus(id);
        Sound.play("blip");
      },
      openTerminal: (cwd) => {
        const path = cwd ?? State.focusedAgentSession?.sessionCwd ?? State.focusTask?.sessionCwd ?? null;
        void Bridge.openInVSCode(path);
      },
      focusTerminal: (task) => {
        void Bridge.focusTerminal(task.terminalHwnd ?? null, task.ancestorPids ?? []).then((ok) => {
          if (!ok) void Bridge.openInVSCode(task.sessionCwd ?? null);
        });
      },
      beginMove: (e, el) => void this.mover.begin(e, el),
      removeSession: (id) => {
        const sid = id.replace(/^session_/, "");
        for (const a of [...State.approvalQueue]) {
          if (a.sessionId === sid) {
            State.removeApproval(a.requestId);
            void Bridge.approvalDecline(a.requestId);
          }
        }
        State.removeSession(sid);
        Sound.play("blip");
      },
      // The ↗ button — same targets as openAgentTarget() on macOS.
      openTarget: () => {
        const task = State.focusTask;
        if (!task) return;
        const urls: Record<string, string> = {
          integration_resend: "https://resend.com/emails",
          integration_vercel: "https://vercel.com/dashboard",
          integration_github: "https://github.com",
          integration_stripe: "https://dashboard.stripe.com/payments",
          integration_notion: "https://notion.so",
          integration_calcom: "https://app.cal.com/bookings",
        };
        if (task.sessionCwd) void Bridge.openInVSCode(task.sessionCwd);
        else if (task.id === "integration_n8n") void Bridge.openN8n();
        else if (urls[task.id]) void Bridge.openUrl(urls[task.id]);
      },
      openUrl: (url) => {
        if (url) void Bridge.openUrl(url);
      },
      decide: (d, answers) => {
        const req = State.pendingApproval;
        void Bridge.log(`decide ${d} req=${req?.requestId ?? "none"}${answers ? " with answers" : ""}`);
        if (!req) return;
        Sound.play(d === "deny" ? "blip" : "approve");
        if (d === "always") {
          const ruleKey = `${req.tool}:${req.command}`;
          State.addAlwaysAllowed(ruleKey);
          void Bridge.saveSettings(State.settings);
        }
        // Declining a question hands it back to the agent's own prompt.
        if (d === "deny" && req.isQuestion) void Bridge.approvalDecline(req.requestId);
        else void Bridge.approvalDecision(req.requestId, d, answers);
        State.removeApproval(req.requestId);
        const next = State.pendingApproval;
        if (next) {
          this.setView("approval");
        } else {
          State.isPinned = false;
          this.fsm.pinned = false;
          const session = State.agentSessions.find((s) => s.id === `session_${req.sessionId}`);
          if (session) {
            session.state = "working";
            session.pillBadge = null;
          }
          this.setView(State.defaultView());
        }
      },
      toggleSound: () => {
        State.settings.soundEnabled = !State.settings.soundEnabled;
        Sound.setEnabled(State.settings.soundEnabled);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setVolume: (v) => {
        State.settings.soundVolume = v;
        Sound.setVolume(v);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setAutoClose: (s) => {
        State.settings.autoCloseInterval = s;
        this.fsm.homeToPetitDelay = s;
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      openSettingsWindow: () => void Bridge.openSettingsWindow(),
      blip: () => Sound.play("blip"),
    };

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.notchNub = h("div", { id: "notch-nub" });
    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.miniGrid = h("div", { id: "mini-grid" });
    this.countdown = h("div", { id: "countdown" });
    this.resizeGrip = h("div", { id: "resize-grip", title: "Drag to resize" });
    this.wireResize();

    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.animateGeometry(false), (shrinking) => {
      if (State.view === "approval" && State.mode === "expanded") this.animateGeometry(shrinking);
    });
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The drop sequence draws the card, the bar and its own Mochi. It sits under
    // the header, which stays visible on top of it exactly as on macOS.
    this.uploadCanvas = new UploadCanvas({
      ask: () => {
        State.promptContext = State.droppedFile
          ? { kind: "file", name: State.droppedFile.name, path: State.droppedFile.path }
          : null;
        this.setView("prompt");
      },
      cancel: () => this.setView(State.defaultView()),
    });

    this.clipEl = h(
      "div",
      { id: "island-clip" },
      this.greetingCanvas,
      this.uploadCanvas.el,
      this.contentEl,
    );
    this.islandEl = h(
      "div",
      { id: "island" },
      this.notchNub,
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.miniGrid,
      this.countdown,
      this.resizeGrip,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(150 * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = "150px";

    this.root.append(this.wakeStrip, this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.toastDelay = State.settings.hideAfter ?? 5;
    this.fsm.petitToHiddenDelay = State.settings.hideAfter ?? 5;
    this.fsm.keepVisible = () => State.isPinned || State.pendingApproval != null;
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "coucou") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (from === "coucou") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(State.defaultView());
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "coucou":
          this.expand("greeting");
          this.greeting.start();
          break;
      }
      State.notify();
    };
  }

  launch() {
    this.fsm.launch();
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    this.root.classList.remove("mode-hidden", "mode-compact", "mode-expanded");
    this.root.classList.add(`mode-${mode}`);
    if (mode === "expanded") Sound.play("open");
    if (prev === "expanded") {
      Sound.play("close");
      State.isPinned = false;
      void Bridge.focusWindow(false);
    }
    if (mode !== "expanded") {
      this.engine.resetMorph();
      // Nothing can be seen of the sequence once the island is shut, and leaving
      // it running would keep the frame loop awake — the island must cost
      // nothing while hidden.
      UploadSeq.deactivate();
    }
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    State.notify();
  }

  /** True while the drop sequence owns the island body. */
  private get uploadActive(): boolean {
    return State.mode === "expanded" && UploadSeq.isActive && UPLOAD_VIEWS.has(State.view);
  }

  /** Navigating out of the drop flow ends the sequence, as on macOS. */
  private stopSequenceIfLeaving(view: IslandViewName) {
    if (UploadSeq.isActive && !UPLOAD_VIEWS.has(view)) UploadSeq.deactivate();
  }

  expand(view: IslandViewName) {
    this.stopSequenceIfLeaving(view);
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.lastActivity = performance.now();
    this.homeCollapseAt = null;
    State.notify();
  }

  setView(view: IslandViewName) {
    this.stopSequenceIfLeaving(view);
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.animateGeometry(false);
      State.notify();
      return;
    }
    const grew = view === "approval" || VIEW_LAYOUTS[view].height >= VIEW_LAYOUTS[State.view].height;
    State.view = view;
    State.lastActivity = performance.now();
    this.animateGeometry(!grew);
    State.notify();
  }

  collapse() {
    State.isPinned = false;
    this.fsm.pinned = false;
    // Drive the state machine rather than the mode: setting the mode behind its
    // back left it thinking the island was still open, and a click on the compact
    // island then did nothing — the island could never be reopened.
    this.fsm.forcePetit();
  }

  /** Alert from the hook server: open on this view. Pinned alerts never auto-close. */
  alert(view: IslandViewName, forceExpanded = false) {
    this.fsm.pinned = State.isPinned;
    if (forceExpanded) {
      this.fsm.forceHome();
      this.expand(view);
    } else {
      this.fsm.revealPinned();
      if (State.mode === "expanded") {
        this.setView(view);
      }
    }
  }

  /** Toast from hook/integration: pop compact for durationSec then auto-hide. */
  toast(view: IslandViewName = "overview", durationSec = State.settings.hideAfter ?? 5) {
    // Open already: don't pull the user away from what they're doing (a chat
    // reply arriving must not switch to the hub) — the pill badge says it.
    if (State.mode === "expanded") return;
    void view;
    this.fsm.revealToast(durationSec);
  }

  reveal() {
    this.fsm.reveal();
  }

  /** An alert stopped waiting for an answer: let the island auto-close again. */
  dropPin() {
    this.fsm.dropPin();
  }

  // ── File drop ───────────────────────────────────────────────────────────────

  /** HTML5 drag events in the page: WebView2 delivers files dropped on the island. */
  private wireHtmlDrop() {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    let depth = 0;
    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (depth++ === 0) this.onDragDrop({ type: "enter" });
    });
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      if (--depth <= 0) {
        depth = 0;
        this.onDragDrop({ type: "leave" });
      }
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      const file = e.dataTransfer?.files?.[0];
      this.onDragDrop({ type: "drop", file: file ?? undefined });
    });
  }

  private onDragDrop(e: { type: string; paths?: string[]; file?: File }) {
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s)`);
    if (State.paused) return;
    switch (e.type) {
      case "enter":
      case "over": {
        if (State.fileDragOver) return;
        State.fileDragOver = true;
        this.engine.animateMorph(1);
        // enterZone must run before the island expands, so the sequence is
        // already active by the time the view becomes `upload`.
        UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
        this.alert("upload");
        break;
      }
      case "leave": {
        if (!State.fileDragOver) return;
        State.fileDragOver = false;
        this.engine.animateMorph(0);
        // The island deliberately stays open: the drag session is still alive.
        UploadSeq.exitZone();
        State.notify();
        break;
      }
      case "drop": {
        State.fileDragOver = false;
        const path = e.paths?.[0];
        if (e.file) {
          this.swallow(e.file.name, () => Bridge.ingestBytes(e.file!));
          break;
        }
        if (!path) {
          this.engine.animateMorph(0);
          this.setView(State.defaultView());
          return;
        }
        this.swallow(path.split(/[\\/]/).pop() || "file", () => Bridge.ingestFile(path));
        break;
      }
    }
  }

  /**
   * Mochi eats the file. Nothing here waits on the file system: the copy into
   * the inbox runs in the background and swaps the path in when it lands, so a
   * slow disk can never stall the animation — same as FileDropHandler on macOS.
   */
  private swallow(name: string, ingest: () => Promise<DroppedFile>) {
    const path = "";
    State.droppedFile = { name, path };
    State.promptContext = { kind: "file", name, path };
    State.chatHistory = [];
    void Bridge.chatReset();

    UploadSeq.performDrop(State.uploadDuration);
    this.uploadTens = 0;
    this.uploadDone = false;

    this.engine.gulp();
    Sound.play("approve");
    this.engine.triggerEmote("happy");
    this.engine.animateMorph(0);

    State.uploadProgress = 0;
    this.setView("uploading");
    this.ensureRunning();

    void ingest()
      .then((file) => {
        State.droppedFile = { name: file.name, path: file.path };
        State.promptContext = { kind: "file", name: file.name, path: file.path };
        State.notify();
      })
      .catch((err) => {
        UploadSeq.deactivate();
        State.noteMessage = String(err).replace(/^Error:\s*/, "");
        this.engine.animateMorph(0);
        this.setView("note");
        Sound.play("error");
        window.setTimeout(() => this.setView(State.defaultView()), 2400);
      });
  }

  /**
   * Sounds and view changes hung off the canvas timeline: a `tick` every 10 %,
   * the ✓ chime when the bar completes, then `choose` once Mochi has grown back.
   */
  private stepSequence() {
    const since = UploadSeq.sinceDrop();
    if (since == null) return;
    const dur = State.uploadDuration;
    const p = Math.max(0, Math.min(1, (since - PRE_PROGRESS) / dur));

    const tens = Math.floor(p * 10);
    if (tens > this.uploadTens && tens < 10) {
      this.uploadTens = tens;
      Sound.play("tick");
    }

    if (!this.uploadDone && since >= PRE_PROGRESS + dur) {
      this.uploadDone = true;
      Sound.play("approve");
      this.engine.triggerEmote("happy");
    }
    // The extra second is the grow-back, after which the choose card is up.
    if (since >= PRE_PROGRESS + dur + 1 && State.view === "uploading") {
      this.setView("choose");
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  private targetSize(): { w: number; h: number; r: number } {
    const { w, h } = islandSize(
      State.mode,
      State.view,
      State.chatHistory.length,
      State.approvalFit,
    );
    const r = State.mode === "expanded"
      ? EXPANDED_CORNER
      : State.mode === "hidden"
      ? NOTCH_TAB_CORNER
      : ROUNDED_CORNER;
    return { w, h, r };
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, r } = this.targetSize();
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(h);
      this.radius.curveTowards(r);
    } else {
      this.width.springTo(w);
      this.height.springTo(h);
      this.radius.springTo(r);
    }
    this.ensureRunning();
  }

  private applyGeometry() {
    const w = this.width.value;
    const hh = this.height.value;
    const r = this.radius.value;
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    const rect0 = this.islandRect();
    this.islandEl.style.transform = this.moveAt?.transform ?? "none";
    // The resize grip sits on the corner away from the docked edge.
    const L0 = geo.layout;
    const showGrip = State.mode === "expanded" && State.view === "agents";
    this.resizeGrip.style.display = showGrip ? "block" : "none";
    this.resizeGrip.dataset.v = L0.v;
    this.resizeGrip.dataset.h = L0.h === "right" ? "left" : "right";
    // The wake strip fills the window while it is only the strip.
    this.wakeStrip.style.cssText = this.collapsed
      ? "left:0;top:0;width:100%;height:100%;transform:none;display:block"
      : "display:none";
    this.islandEl.style.left = `${rect0.x}px`;
    this.islandEl.style.top = `${rect0.y}px`;
    this.islandEl.style.bottom = "auto";
    // Round every corner that does not touch the screen edge it is docked to.
    const edge = geo.layout.edge;
    const [tl, tr, br, bl] =
      edge === "top" ? [0, 0, r, r]
      : edge === "bottom" ? [r, r, 0, 0]
      : edge === "left" ? [0, r, r, 0]
      : [r, 0, 0, r];
    this.islandEl.style.borderRadius = this.moveAt ? `${r}px` : `${tl}px ${tr}px ${br}px ${bl}px`;
    // These follow the island as it resizes, so they belong here rather than in
    // the state-driven DOM sync.
    // The mini bots ride at the far end of the compact pill: right on top and
    // bottom edges, the bottom of the upright pill on the sides.
    if (onSide()) {
      this.miniGrid.style.left = `${w / 2 - 14.5}px`;
      this.miniGrid.style.top = `${hh - 40 - 14.5}px`;
    } else {
      this.miniGrid.style.left = `${w - 40 - 14.5}px`;
      this.miniGrid.style.top = `${hh / 2 - 14.5}px`;
    }
    this.greetingCanvas.style.left = `${(w - EXPANDED_W) / 2}px`;
    this.uploadCanvas.el.style.left = `${(w - EXPANDED_W) / 2}px`;

    const rect = this.islandRect();
    const p = this.pushedRect;
    if (
      Math.abs(p.x - rect.x) > 0.5 || Math.abs(p.y - rect.y) > 0.5 ||
      Math.abs(p.w - rect.w) > 0.5 || Math.abs(p.h - rect.h) > 0.5
    ) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  /** Island rect in window coordinates (origin top-left of the window). */
  private islandRect(): { x: number; y: number; w: number; h: number } {
    const w = this.width.value;
    const hh = this.height.value;
    // Being moved: centred under the cursor in the overlay.
    if (this.moveAt) return { x: this.moveAt.x - w / 2, y: this.moveAt.y - hh / 2, w, h: hh };
    const L = geo.layout;
    if (this.collapsed) {
      // The window is only the wake strip; the tab sits in it.
      const sw = L.vertical ? WAKE_STRIP_H : WAKE_STRIP_W;
      const sh = L.vertical ? WAKE_STRIP_W : WAKE_STRIP_H;
      const x = L.h === "left" ? 0 : L.h === "right" ? sw - w : (sw - w) / 2;
      const y = L.vertical ? (sh - hh) / 2 : L.v === "bottom" ? sh - hh : 0;
      return { x, y, w, h: hh };
    }
    const x =
      L.h === "left" ? 0
      : L.h === "right" ? L.panelW - w
      : Math.min(Math.max(L.anchorX - w / 2, 0), Math.max(0, L.panelW - w));
    return { x, y: this.atBottom ? L.panelH - hh : 0, w, h: hh };
  }

  /**
   * The corner grip (Agents hub): drag to set the island's width and the hub's
   * height. Rust gives the window its largest size meanwhile; the new size is
   * saved on release, which fits the window to it again.
   */
  private wireResize() {
    const g = this.resizeGrip;
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      this.resizing = { sx: e.screenX, sy: e.screenY, w: geo.expandedW, h: geo.hubH };
      State.isPinned = true;
      this.fsm.pinned = true;
      this.root.classList.add("resizing");
      void Bridge.islandResizeMode(true);
    });
    g.addEventListener("pointermove", (e) => {
      const r = this.resizing;
      if (!r) return;
      const L = geo.layout;
      const dx = e.screenX - r.sx;
      const dy = e.screenY - r.sy;
      const dw = L.h === "center" ? 2 * dx : L.h === "left" ? dx : -dx;
      const dh = L.v === "bottom" ? -dy : dy;
      geo.expandedW = Math.round(Math.min(1100, Math.max(520, r.w + dw)));
      geo.hubH = Math.round(Math.min(640, Math.max(220, r.h + dh)));
      this.animateGeometry(false);
    });
    const end = (e: PointerEvent) => {
      if (!this.resizing) return;
      this.resizing = null;
      if (g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
      this.root.classList.remove("resizing");
      State.isPinned = State.approvalQueue.length > 0;
      this.fsm.pinned = State.isPinned;
      State.settings.islandWidth = geo.expandedW;
      State.settings.hubHeight = geo.hubH;
      void Bridge.saveSettings(State.settings);
    };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
  }

  /** The island grows up from its anchor (bottom edge, or low on the screen). */
  private get atBottom(): boolean {
    return geo.layout.v === "bottom";
  }

  /** Rust placed the window: draw the island where it now belongs. */
  setLayout(layout: IslandLayout) {
    geo.layout = layout;
    this.root.classList.toggle("at-bottom", this.atBottom);
    this.root.dataset.edge = layout.edge;
    this.applyGeometry();
    this.animateGeometry(false);
    State.notify();
  }

  // ── Window collapse (hidden → tiny wake strip, zero polling) ────────────────

  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (State.mode === "hidden") {
      // Let the island finish retracting, then drop the window to the wake strip:
      // from there the OS delivers no cursor events, so nothing polls at all.
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (State.mode !== "hidden") return;
        this.collapsed = true;
        this.applyGeometry();
        void Bridge.setCollapsed(true);
      }, 420);
    } else if (this.collapsed) {
      // Grow the window back before the island animates open.
      this.collapsed = false;
      void Bridge.setCollapsed(false);
    }
  }

  onNotchHover() {
    Sound.resume();
    this.wasInIsland = true;
    if (State.mode === "hidden") {
      this.fsm.mouseEntered();
    }
  }

  onNotchClick() {
    Sound.resume();
    State.lastActivity = performance.now();
    if (State.mode === "hidden") {
      this.wasInIsland = true;
      this.fsm.mouseEntered();
      this.fsm.click();
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    // Both the visible notch tab (islandEl) and the wakeStrip trigger wake to compact
    const onEnter = () => {
      Sound.resume();
      this.wasInIsland = true;
      if (State.mode === "hidden") {
        this.fsm.mouseEntered();
      }
    };

    this.wakeStrip.addEventListener("mouseenter", onEnter);
    this.islandEl.addEventListener("mouseenter", onEnter);

    this.islandEl.addEventListener("mouseleave", () => {
      this.wasInIsland = false;
      this.fsm.mouseLeft();
    });

    // Alt + press anywhere on the island moves it.
    this.islandEl.addEventListener("pointerdown", (e) => {
      if (e.altKey && e.button === 0) void this.mover.begin(e, this.islandEl);
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      if (State.mode === "hidden") {
        this.fsm.mouseEntered();
        this.fsm.click();
        return;
      }
      if (State.mode !== "expanded") {
        if (State.pendingApproval) {
          this.expand("approval");
        } else {
          this.fsm.click();
        }
        return;
      }
      if (this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.engine.slap();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && State.mode === "expanded" && !State.isPinned) this.collapse();
      State.lastActivity = performance.now();
    });

    void onDragDrop((e) => this.onDragDrop(e));
    this.wireHtmlDrop();
    // A drag from elsewhere is heading for the sleeping island: open the drop page.
    void onEvent<null>("notch-drag-near", () => {
      if (State.paused || UploadSeq.isActive) return;
      this.dropWoke = true;
      this.alert("upload", true);
    });
    void onEvent<null>("notch-drag-end", () => {
      window.setTimeout(() => {
        if (this.dropWoke && !State.fileDragOver && !UploadSeq.isActive && State.view === "upload") this.collapse();
        this.dropWoke = false;
      }, 400);
    });

    // Outside Tauri (plain browser) drive the cursor from DOM events so the
    // island can be inspected with `npm run dev`.
    if (!IS_TAURI) {
      window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    }
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    State.mouse = { x, y };
    const rect = this.islandRect();
    State.mouseInIsland = { x: x - rect.x, y: y - rect.y };

    // Windows sends no cursor position with an OLE drag, so the drop sequence is
    // fed from the Win32 cursor poll instead — it runs throughout the drag.
    if (UploadSeq.isActive && !UploadSeq.dropped) {
      UploadSeq.updateCursor(State.mouseInIsland.x, State.mouseInIsland.y);
    }

    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    if (inIsland && !this.wasInIsland) {
      if (this.fsm.state === "coucou") this.greeting.hover();
      this.fsm.mouseEntered();
      this.homeCollapseAt = null;
    }
    if (!inIsland && this.wasInIsland) {
      this.fsm.mouseLeft();
      if (this.fsm.state === "home" && !State.isPinned) {
        this.homeCollapseAt = performance.now() + State.settings.autoCloseInterval * 1000;
      }
    }
    this.wasInIsland = inIsland;

    // Bot hover → love
    const overBot = State.mode === "expanded" && State.stateOverride == null && this.isBotHit(x, y);
    if (overBot && !this.botHovering) this.botHoverIn(x, y);
    if (!overBot && this.botHovering) this.cancelBotHover();
    this.botHovering = overBot;
    if (this.botHovering) {
      const d = Math.hypot(x - this.botHoverStart.x, y - this.botHoverStart.y);
      if (d > 40) {
        this.botHoverStart = { x, y };
        this.scheduleLove();
      }
    }

    this.ensureRunning();
  }

  private isBotHit(x: number, y: number): boolean {
    const rect = this.islandRect();
    const cx = rect.x + this.botCx.value;
    const cy = rect.y + this.botCy.value;
    const radius = this.botSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }

  private botHoverIn(x: number, y: number) {
    if (performance.now() / 1000 - this.lastLoveTime < 6) return;
    this.botHoverStart = { x, y };
    this.engine.blink();
    this.engine.tgEs = 1.08;
    Sound.play("hover");
    this.scheduleLove();
  }

  private scheduleLove() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = window.setTimeout(() => {
      this.botHoverTimer = null;
      if (!this.botHovering || State.stateOverride != null) return;
      if (performance.now() / 1000 - this.lastLoveTime < 6) return;
      this.lastLoveTime = performance.now() / 1000;
      this.engine.triggerEmote("love");
      Sound.play("love");
    }, 1900);
  }

  private cancelBotHover() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = null;
    this.engine.tgEs = 1;
  }

  /** Three slaps → dizzy + confused view for 3.3 s, then back. */
  private handleDizzy() {
    this.prevViewBeforeConfused = State.view;
    State.stateOverride = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    this.alert("confused");
    if (this.confusedRecovery != null) window.clearTimeout(this.confusedRecovery);
    this.confusedRecovery = window.setTimeout(() => {
      this.confusedRecovery = null;
      State.stateOverride = null;
      this.engine.setState(State.effectiveState);
      if (State.view === "confused") {
        const fallback = State.defaultView();
        this.setView(this.prevViewBeforeConfused === "confused" ? fallback : this.prevViewBeforeConfused);
      }
      this.engine.triggerEmote("happy");
    }, 3300);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
    }

    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    if (greetingActive) {
      const gctx = this.greetingCanvas.getContext("2d");
      if (gctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(gctx);
      }
    } else {
      // Kept running even while the drop canvas is up, so the island's own Mochi
      // is already in the right place the moment the canvas fades out.
      this.drawBot(dt);
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) this.uploadCanvas.draw(UploadSeq.frame(), nowMs / 1000);
    this.uploadCanvas.el.classList.toggle("on", uploadActive);
    this.viewsEl.classList.toggle("hidden-by-upload", uploadActive);

    tickMiniBots(dt);
    this.views.get(State.view)?.tick?.(nowMs);
    if (UploadSeq.isActive) this.stepSequence();
    this.updateCountdown(nowMs);

    // Nothing is drawn while the island is hidden, so nothing may keep the loop
    // alive either. This used to read `... || this.engine.busy || State.mode !==
    // "hidden"`, and engine.busy is permanently true for any state with a
    // looping animation — breathing, ratelimit sweat, sleeping z's, the search
    // sweep — so a hidden island went on burning frames in exactly the states it
    // spends most of its life in. Geometry still has to finish retracting.
    const settling =
      this.width.animating || this.height.animating || this.radius.animating;
    const busy = State.mode === "hidden"
      ? settling
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || UploadSeq.isActive;

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private updateBotTargets() {
    const p = botPosition(State.mode, State.view, this.height.value, State.uploadProgress);
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    // The drop canvas draws its own Mochi; two of them would overlap.
    const visible = p.opacity > 0 && !greetingActive && !this.uploadActive;
    this.botCanvas.style.opacity = visible ? "1" : "0";

    if (State.mode === "expanded" && State.view !== "uploading" && !greetingActive && !this.uploadActive) {
      const d = p.diameter;
      // On the Agents hub Mochi glows in the focused agent's colour, unless
      // that session needs attention (approval, error keep their own colour).
      const hubSession = State.view === "agents" ? State.focusedAgentSession : null;
      const color = hubSession && !["approval", "error", "ratelimit"].includes(hubSession.state)
        ? hubSession.color
        : botGlowColor(this.botState());
      this.botGlow.style.display = "block";
      this.botGlow.style.width = `${d * 2.2}px`;
      this.botGlow.style.height = `${d * 2.2}px`;
      this.botGlow.style.left = `${this.botCx.value - d * 1.1}px`;
      this.botGlow.style.top = `${this.botCy.value - d * 1.1}px`;
      this.botGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
      this.botGlow.style.opacity = String(hubSession ? Math.max(0.4, botGlowOpacity(hubSession.state)) : botGlowOpacity(this.botState()));
    } else {
      this.botGlow.style.display = "none";
    }
  }

  private drawBot(dt: number) {
    const size = this.botSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + BOT_OVERHANG;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvasPx !== w) {
      this.canvasPx = w;
      this.botCanvas.width = Math.round(w * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${w}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
    this.botCanvas.style.left = `${this.botCx.value - w / 2}px`;
    this.botCanvas.style.top = `${this.botCy.value - BOT_OVERHANG / 2 - hCss / 2}px`;

    const ctx = this.botCanvas.getContext("2d");
    if (!ctx) return;

    const focus = State.focusTask;
    // Awuuu keeps its own cream-and-caramel coat, except where a pill is
    // picked: the overview wears the focused integration's colour, the
    // Agents hub the colour of the session you tapped.
    const tapped = State.view === "agents" && State.mode === "expanded" ? State.focusedAgentSession : null;
    const tint = State.mode === "expanded" && State.view === "overview" && focus?.isIntegration
      ? focus.color
      : tapped?.color ?? null;
    this.engine.bodyColor = tint ? hexToRGB(tint) : null;
    this.engine.particleOverhang = BOT_OVERHANG;
    this.engine.lookX = this.lookX();
    this.engine.lookY = this.lookY();
    if (this.engine.morph > 0.3) {
      this.engine.slotHTarget = State.fileDragOver ? 0.2 : 0;
    } else {
      this.engine.slotHTarget = 0;
      if (this.engine.morph < 0.05) {
        this.engine.slotH = 0;
        this.engine.slotHVel = 0;
      }
    }
    this.engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hCss);
    this.engine.draw(ctx, w, hCss);
  }

  /** BotCanvasView.lookX / lookY — tanh of the distance to the bot. */
  private lookX(): number {
    const rect = this.islandRect();
    const botScreenX = rect.x + this.botCx.value;
    return Math.tanh((State.mouse.x - botScreenX) / 260);
  }

  private lookY(): number {
    return -Math.tanh((State.mouse.y - this.botCy.value) / 200);
  }

  private updateCountdown(nowMs: number) {
    if (State.mode !== "expanded" || State.isPinned || this.homeCollapseAt == null) {
      this.countdown.style.width = "0px";
      return;
    }
    const autoClose = State.settings.autoCloseInterval;
    const windowS = Math.min(10, autoClose * 0.6);
    const remaining = (this.homeCollapseAt - nowMs) / 1000;
    this.countdown.style.width =
      remaining < windowS ? `${Math.max(0, clamp(remaining / windowS, 0, 1) * 160)}px` : "0px";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    const expanded = State.mode === "expanded";
    const greetingActive = expanded && State.view === "greeting";

    this.contentEl.style.opacity = expanded && !greetingActive ? "1" : "0";
    this.contentEl.style.pointerEvents = expanded && !greetingActive ? "auto" : "none";
    this.greetingCanvas.style.display = greetingActive ? "block" : "none";

    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }

    // The chat is the only view with a text field, so it is the only time the
    // island is allowed to take keyboard focus.
    if (this.lastSyncedView !== State.view) {
      const wasChat = this.lastSyncedView === "prompt";
      this.lastSyncedView = State.view;
      if (State.view === "prompt") {
        void Bridge.focusWindow(true);
        window.setTimeout(() => this.views.get("prompt")?.focus?.(), 120);
      } else if (wasChat) {
        void Bridge.focusWindow(false);
      }
    }

    // Compact mini grid
    const showGrid = State.mode === "compact";
    this.miniGrid.style.opacity = showGrid ? "1" : "0";
    if (showGrid) {
      const others = State.otherTasks.slice(0, 4);
      const key = others.map((t) => t.id).join("|");
      if (this.miniGrid.dataset.key !== key) {
        this.miniGrid.dataset.key = key;
        this.miniGrid.replaceChildren();
        for (const t of others) {
          this.miniGrid.append(createMiniBot(t, 13));
        }
        pruneMiniBots();
      }
    }

    syncMiniBotStates(State.tasks);
    this.engine.setState(this.botState());
  }

  /**
   * How Mochi looks right now. In the chat and on the drop page it is the
   * chat's own companion — thinking while a reply is on its way, calm
   * otherwise — not a mirror of some session running elsewhere.
   */
  private botState() {
    const own = ["prompt", "upload", "uploading", "choose", "searching", "result", "note"];
    if (State.mode === "expanded" && own.includes(State.view)) return State.stateOverride ?? "idle";
    return State.effectiveState;
  }

  /** Applies settings coming from Rust at boot. */
  applySettings() {
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.petitToHiddenDelay = State.settings.hideAfter ?? 5;
    this.fsm.toastDelay = State.settings.hideAfter ?? 5;
    geo.expandedW = State.settings.islandWidth ?? 640;
    geo.hubH = State.settings.hubHeight ?? 290;
    this.root.classList.toggle("at-bottom", this.atBottom);
    this.applyGeometry();
    this.animateGeometry(false);
    State.notify();
  }

  get panelSize() {
    return { w: geo.layout.panelW, h: geo.layout.panelH };
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
