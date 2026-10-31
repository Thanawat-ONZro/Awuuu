// The island: DOM shell, sizing animation, Mochi placement, mouse handling.
// Mirrors IslandRootView.swift + IslandWindowController.swift.

import { Tracked, Spring, clamp } from "../core/anim";
import { animateView, directionBetween, type Direction } from "./transition";
import { Bridge, IS_TAURI, onDragDrop, onEvent, type DroppedFile, type NowPlaying, type SystemVolume } from "../core/bridge";
import {
  EXPANDED_CORNER, GREETING_W, NOTCH_TAB_CORNER, NOTCH_W, geo, onSide, type IslandLayout,
  ROUNDED_CORNER, VIEW_LAYOUTS, WAKE_STRIP_H, WAKE_STRIP_W, TOP_STRIP_WINDOW_W, TOP_STRIP_WINDOW_H, botGlowColor, botGlowOpacity, botPosition, chatPromptHeight,
  islandSize, getOrientationBounds,
  type IslandMode, type IslandViewName, SIDE_COMPACT, SIDE_GAP,
  agentColumnPosition, shouldShowEars, getColumnAgents,
} from "../core/layout";

import { Sound } from "../core/sound";
import { State, type AgentTask, type PendingFile } from "../core/state";
import { BotEngine } from "../mochi/engine";
import { setOwnerLook } from "../mochi/dog";
import { setOutfitSelection } from "../mochi/outfits";
import { CLASSIC, lookForAgent, normalizeLook, type DogLook } from "../mochi/looks";
import { Greeting } from "../mochi/greeting";
import { createMiniBot, pruneMiniBots, syncMiniBotStates, tickMiniBots } from "../mochi/minibots";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { isModuleEnabled, isModuleInCollapsedStrip } from "../core/modules";
import { IslandStateMachine } from "./fsm";
import { HoverOpen } from "./hover";
import { DROPLET, Mover } from "./move";
import { clampCornerRadius, computeDockedTarget } from "./move-physics";
import { Liquid } from "./liquid";
import { DesktopDogLink } from "./desktop-dog";
import { isDrag } from "../mochi/desktop-logic";
import { t } from "../i18n/i18n";
import { dismissNotification, pushNotification } from "../core/notifications";

const BOT_OVERHANG = 40;
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;

/** The views the drop sequence draws; leaving them stops the engine. */
const UPLOAD_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading"]);
/** The drop flow: the island stays open until the files are asked about or let go. */
const DROP_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading", "choose"]);

/** Seconds after the bar completes before the files card takes over (the bar has faded). */
const HANDOVER = 0.45;

/** What a drop brings: one entry per file, with the way to copy it into the inbox. */
interface DropItem {
  name: string;
  /** Bytes when known up front (a File), else 0. */
  size: number;
  key: string;
  ingest: () => Promise<DroppedFile>;
}

let nextFileId = 1;

/** Seconds between the drop and the moment the progress bar starts filling. */
const PRE_PROGRESS = USC.T_PROG_START - USC.T_DROP;

/** Width over which a side-docked island leaves the edge as it opens. */
const SIDE_LIFT = 160;

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();
  /** Open on hover (Settings → General); the timing lives in hover.ts. */
  private readonly hover: HoverOpen = new HoverOpen({
    enabled: () => State.settings.openOnHover === true,
    open: () => {
      if (this.fsm.state !== "petit") return false;
      this.fsm.click(); // compact → home
      return true;
    },
    fold: () => {
      if (this.fsm.state !== "home" || State.isPinned || State.pendingApproval) return;
      this.fsm.forcePetit();
    },
  });

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private agentColumn!: HTMLElement;
  private earLeft!: HTMLElement;
  private earRight!: HTMLElement;

  get leftEarEl(): HTMLElement {
    return this.earLeft;
  }
  get rightEarEl(): HTMLElement {
    return this.earRight;
  }
  get agentColumnEl(): HTMLElement {
    return this.agentColumn;
  }

  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;
  private compactStrip!: HTMLElement;
  private compactMediaTimer: number | null = null;
  private lastCompactKey = "";
  private compactMedia: NowPlaying | null = null;
  private compactMediaReady = false;
  private compactArtwork: string | null = null;
  private compactTrackKey = "";
  private volumeHudUntil = 0;
  private volumeHudTimer: number | null = null;
  private volumeHud: SystemVolume | null = null;
  private mover!: Mover;
  /** The drop page was opened by a drag coming near (notch-drag-near). */
  private dropWoke = false;
  /** The drop flow pinned the island open (released when the flow is left). */
  private dropPinned = false;
  /** Set while the island is being moved (move.ts). */
  private moveAt: { x: number; y: number; transform: string } | null = null;
  private resizeGrip!: HTMLElement;
  private resizing: { sx: number; sy: number; w: number; h: number; chat: boolean; agents: boolean } | null = null;
  private notchNub!: HTMLElement;

  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  private uploadCanvas!: UploadCanvas;

  private width = new Tracked(NOTCH_W);
  private height = new Tracked(0);
  private cornerTL = new Tracked(0);
  private cornerTR = new Tracked(0);
  private cornerBR = new Tracked(ROUNDED_CORNER);
  private cornerBL = new Tracked(ROUNDED_CORNER);
  private liquidCanvas!: HTMLCanvasElement;
  private liquid!: Liquid;
  private botCx = new Spring(46);
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine();
  /** The dog on the desktop (Settings → General): its life cycle and the drag out. */
  readonly desktopDog = new DesktopDogLink(() => {
    this.dirty = true;
    State.notify();
    this.ensureRunning();
  });
  /** A press on the island's dog that may become a drag to the desktop. */
  private dogPress: { x: number; y: number } | null = null;
  /** The owner's own dog (settings.dog); agents and integrations wear theirs. */
  private ownLook: DogLook = CLASSIC;
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
  /** View and mode at the previous syncDom, to know whether a view change is worth animating. */
  private animView: IslandViewName | null = null;
  private animExpanded = false;
  /** Session states as last drawn, to catch one finishing or failing (syncGlow). */
  private glowStates = new Map<string, string>();

  /** Drop sequence bookkeeping: last tick played, and whether the ✓ has fired. */
  private uploadTens = 0;
  private uploadDone = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.dataset.edge = geo.layout.edge;
    this.build();
    this.wireFsm();
    this.mover = new Mover(
      {
        rect: () => this.islandRect(),
        currentGeometry: () => {
          const w = this.width.value;
          const h = this.height.value;
          return {
            w,
            h,
            radii: [
              clampCornerRadius(this.cornerTL.value, w, h),
              clampCornerRadius(this.cornerTR.value, w, h),
              clampCornerRadius(this.cornerBR.value, w, h),
              clampCornerRadius(this.cornerBL.value, w, h),
            ],
          };
        },
        applyDockedLayout: (layout) => {
          geo.layout = { ...layout, anchorY: layout.anchorY ?? layout.panelH / 2 };
          this.root.dataset.edge = layout.edge;
          this.root.classList.toggle("at-bottom", this.atBottom);
        },
        setMoveOverride: (at) => {
          const changed = (this.moveAt === null) !== (at === null);
          this.moveAt = at;
          // Picked up: the pill rounds into a droplet; put down: back again.
          if (changed) this.animateGeometry(false);
          this.applyGeometry();
        },
        enterMove: () => {
          const saved = { wasExpanded: State.mode === "expanded", view: State.view };
          const r0 = this.islandRect();
          this.contentEl.style.width = `${r0.w}px`;
          this.contentEl.style.height = `${r0.h}px`;
          this.contentEl.style.left = "50%";
          this.contentEl.style.top = "50%";
          this.contentEl.style.transform = "translate(-50%, -50%)";
          this.fsm.pinned = true;
          if (State.mode !== "compact") this.collapse();
          this.fsm.pinned = true;
          return saved;
        },
        leaveMove: (saved) => {
          this.contentEl.style.width = "";
          this.contentEl.style.height = "";
          this.contentEl.style.left = "";
          this.contentEl.style.top = "";
          this.contentEl.style.transform = "";
          this.fsm.pinned = State.isPinned;
          if (saved.wasExpanded) {
            this.fsm.forceHome();
            this.expand(saved.view as IslandViewName);
          }
        },
        startLiquid: () => {
          if (this.liquid.isReady()) {
            this.liquidCanvas.style.display = "block";
            this.root.classList.add("liquid-active");
          }
        },
        stepLiquid: (cx, cy, work, swell) => {
          if (!this.liquid.isReady()) return;
          this.liquidCanvas.style.display = "block";
          this.root.classList.add("liquid-active");
          const w = this.width.value;
          const hh = this.height.value;
          const tl = clampCornerRadius(this.cornerTL.value, w, hh);
          const tr = clampCornerRadius(this.cornerTR.value, w, hh);
          const br = clampCornerRadius(this.cornerBR.value, w, hh);
          const bl = clampCornerRadius(this.cornerBL.value, w, hh);
          this.liquid.frame({
            w,
            h: hh,
            radii: [tl, tr, br, bl],
            cx,
            cy,
            swell,
            work,
            dpr: Math.min(2, window.devicePixelRatio || 1),
          });
        },
        applyMorph: (cx, cy, w, hh, radii, work, swell) => {
          this.moveAt = { x: cx, y: cy, transform: "none" };
          this.width.jump(w);
          this.height.jump(hh);
          this.cornerTL.jump(radii[0]);
          this.cornerTR.jump(radii[1]);
          this.cornerBR.jump(radii[2]);
          this.cornerBL.jump(radii[3]);
          this.applyGeometry();
          if (this.liquid.isReady()) {
            this.liquid.frame({
              w,
              h: hh,
              radii,
              cx,
              cy,
              swell,
              work,
              dpr: Math.min(2, window.devicePixelRatio || 1),
            });
          }
        },
        getDockedTarget: (dockRect, layout, origin, scale) => {
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
          const edge = layout.edge;
          const isSide = edge === "left" || edge === "right";
          const lift = isSide ? this.sideGap(w) / SIDE_GAP : 0;
          const radii: [number, number, number, number] =
            edge === "top" ? [0, 0, r, r]
            : edge === "bottom" ? [r, r, 0, 0]
            : edge === "left" ? [r * lift, r, r, r * lift]
            : [r, r * lift, r * lift, r];

          return computeDockedTarget(
            dockRect,
            layout,
            { w, h },
            radii,
            origin,
            scale,
            isSide ? this.sideGap(w) : 0
          );
        },
        clearLiquid: () => {
          this.liquid.clear();
          this.liquidCanvas.style.display = "none";
          this.root.classList.remove("liquid-active");
        },
      },

      this.root,
    );
    this.wireInput();
    void this.desktopDog.init();
    this.engine.onDizzy = () => this.handleDizzy();
    this.greeting.onComplete = () => this.fsm.greetComplete();
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
    });
    this.scheduleFidget();
    // A hidden document draws nothing: the loop stops in frame() and restarts here.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.ensureRunning();
    });
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
      showNote: (msg) => this.showNote(msg),
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
        void Bridge.openInVSCode(path).then((ok) => {
          if (!ok) this.showNote(t("Couldn't open a terminal for this session."));
        });
      },
      focusTerminal: (task) => {
        void Bridge.focusTerminal(task.terminalHwnd ?? null, task.ancestorPids ?? []).then((ok) => {
          if (!ok) {
            void Bridge.openInVSCode(task.sessionCwd ?? null).then((okVS) => {
              if (!okVS) this.showNote(t("Couldn't open a terminal for this session."));
            });
          }
        });
      },
      beginMove: (e, el) => void this.mover.begin(e, el),
      removeSession: (id) => {
        const sid = id.replace(/^session_/, "");
        for (const a of [...State.approvalQueue]) {
          if (a.sessionId === sid) {
            State.removeApproval(a.requestId);
            dismissNotification(`approval-${a.requestId}`);
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
        if (task.sessionCwd) {
          void Bridge.openInVSCode(task.sessionCwd).then((ok) => {
            if (!ok) this.showNote(t("Couldn't open a terminal for this session."));
          });
        }
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
        dismissNotification(`approval-${req.requestId}`);
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
      openSettingsWindow: (page) => void Bridge.openSettingsWindow(page),
      blip: () => Sound.play("blip"),
    };

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.notchNub = h("div", { id: "notch-nub" });
    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.miniGrid = h("div", { id: "mini-grid" });
    this.agentColumn = h("div", { id: "agent-column" });
    this.earLeft = h("div", { id: "ear-left", class: "island-ear" });
    this.earRight = h("div", { id: "ear-right", class: "island-ear" });
    this.countdown = h("div", { id: "countdown" });
    this.compactStrip = h("div", { id: "compact-strip", style: "display:none" });
    void onEvent<NowPlaying | null>("media-changed", (info) => this.onMediaChanged(info));
    void onEvent<SystemVolume>("system-volume-changed", (volume) => this.onSystemVolumeChanged(volume));
    this.resizeGrip = h("div", { id: "resize-grip", title: t("Drag to resize") });
    this.wireResize();

    // Ctrl+Alt+Y / Ctrl+Alt+N answer the card; the keys are held only while one waits.
    let keysOn = false;
    State.subscribe(() => {
      const want = !!State.pendingApproval;
      if (want !== keysOn) {
        keysOn = want;
        void Bridge.setApprovalKeys(want);
      }
    });
    void onEvent<string>("approval-key", (d) => {
      const req = State.pendingApproval;
      if (!req) return;
      // A question needs its options picked; N hands it back to the terminal.
      if (req.isQuestion && d !== "deny") return;
      actions.decide(d === "allow" ? "allow" : "deny");
    });
    // The other global shortcuts (Settings → Shortcuts). They never take focus
    // from the active app; only the chat's own text field does, via setView.
    void onEvent<string>("shortcut", (id) => {
      switch (id) {
        case "openChat":
          this.alert("prompt", true);
          break;
        case "goToAlert":
          if (State.pendingApproval) this.alert("approval", true);
          break;
        case "jumpToTerminal": {
          const sid = State.pendingApproval?.sessionId;
          const task = (sid ? State.agentSessions.find((s) => s.id === `session_${sid}`) : null)
            ?? State.focusedAgentSession ?? State.focusTask;
          if (task && !task.isIntegration) actions.focusTerminal(task);
          else actions.openTerminal(task?.sessionCwd ?? null);
          break;
        }
        case "muteToggle":
          actions.toggleSound();
          break;
        case "toggleIsland":
          if (State.mode === "expanded") this.collapse();
          else this.alert(State.defaultView(), true);
          break;
        case "openDashboard":
          this.alert("overview", true);
          break;
        case "toggleDesktopDog":
          this.desktopDog.toggle();
          break;
      }
    });

    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.animateGeometry(false), (shrinking) => {
      if (State.view === "approval" && State.mode === "expanded") this.animateGeometry(shrinking);
    });
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The drop sequence draws the card, the bar and its own Mochi. It sits under
    // the header, which stays visible on top of it exactly as on macOS. Asking
    // and cancelling are the files card's buttons (views/upload.ts): painted
    // buttons here sat under the invisible views, which took their clicks.
    this.uploadCanvas = new UploadCanvas();

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
      this.earLeft,
      this.earRight,
      this.notchNub,
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.compactStrip,
      this.miniGrid,
      this.agentColumn,
      this.countdown,
      this.resizeGrip,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(GREETING_W * dpr);
    this.greetingCanvas.height = Math.round(VIEW_LAYOUTS.greeting.height * dpr);

    this.liquidCanvas = h("canvas", { id: "liquid", class: "move-layer" }) as HTMLCanvasElement;
    this.liquidCanvas.style.display = "none";
    this.liquid = new Liquid(this.liquidCanvas);
    this.liquid.onLost = () => {
      this.root.classList.remove("liquid-active");
    };
    this.liquid.onRestored = () => {
      if (this.moveAt) {
        this.root.classList.add("liquid-active");
      }
    };

    this.root.append(this.wakeStrip, this.liquidCanvas, this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.toastDelay = State.settings.hideAfter ?? 5;
    this.fsm.petitToHiddenDelay = State.settings.hideAfter ?? 5;
    this.fsm.keepVisible = () => State.isPinned || State.pendingApproval != null;
    this.fsm.onTransition = (from, to) => {
      // The greeting is over, however it ended: the dog may go back to the desktop.
      if (from === "awuuu" && to !== "awuuu") this.desktopDog.launch();
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "awuuu") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (from === "awuuu") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(State.defaultView());
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "awuuu":
          this.expand("greeting");
          this.greeting.fit(this.viewsEl, this.width.value || GREETING_W, this.height.value || VIEW_LAYOUTS.greeting.height);
          this.greeting.start();
          break;
      }
      State.notify();
    };
  }

  launch() {
    this.fsm.launch();
    void Bridge.nowPlaying().then((info) => this.onMediaChanged(info));
    // Should the greeting never end, the desktop dog still comes out.
    window.setTimeout(() => this.desktopDog.launch(), 10000);
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
    if (mode !== "compact") {
      if (this.compactStrip) this.compactStrip.style.display = "none";
      if (this.compactMediaTimer != null) {
        window.clearInterval(this.compactMediaTimer);
        this.compactMediaTimer = null;
      }
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

  expand(view: IslandViewName = State.defaultView()) {
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
      this.expand(view);
      return;
    }
    const currentH = VIEW_LAYOUTS[State.view]?.height ?? geo.hubH;
    const nextH = VIEW_LAYOUTS[view]?.height ?? geo.hubH;
    const grew = view === "approval" || nextH >= currentH;
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

  /** Note message: display note view for duration then restore previous view. */
  showNote(message: string, durationMs = 2400) {
    const prevView = State.view !== "note" ? State.view : State.defaultView();
    State.noteMessage = message;
    this.engine.animateMorph(0);
    this.setView("note");
    window.setTimeout(() => {
      if (State.view === "note" && State.noteMessage === message) {
        this.setView(prevView);
      }
    }, durationMs);
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
      this.onDragDrop({ type: "drop", files: Array.from(e.dataTransfer?.files ?? []) });
    });
    // Asking about the files, cancelling, or any other way out of the drop flow
    // lets the island close by itself again.
    State.subscribe(() => {
      if (!this.dropPinned || DROP_VIEWS.has(State.view)) return;
      this.dropPinned = false;
      this.fsm.pinned = State.isPinned;
    });
  }

  /** Opens the drop page and keeps the island open for as long as the drop flow lasts. */
  private openForDrop() {
    // Through the state machine: a closed island opens on its default view on
    // the way, which would end a sequence already running — so this comes first.
    if (State.mode !== "expanded" || State.view !== "upload") this.alert("upload", true);
    this.dropPinned = true;
    this.fsm.pinned = true;
    this.fsm.cancelTimers();
  }

  private onDragDrop(e: { type: string; paths?: string[]; files?: File[] }) {
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${(e.paths?.length ?? 0) + (e.files?.length ?? 0)} file(s)`);
    if (State.paused) return;
    switch (e.type) {
      case "enter":
      case "over": {
        if (State.fileDragOver) return;
        State.fileDragOver = true;
        this.engine.animateMorph(1);
        this.openForDrop();
        // The sequence is active before the next frame is drawn, so the drop
        // page never shows without it.
        this.uploadCanvas.fit(this.viewsEl);
        UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
        this.ensureRunning();
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
        const items: DropItem[] = [
          ...(e.files ?? []).map((file) => ({
            name: file.name,
            size: file.size,
            key: `${file.name}|${file.size}`,
            ingest: () => Bridge.ingestBytes(file),
          })),
          ...(e.paths ?? []).map((path) => ({
            name: path.split(/[\\/]/).pop() || "file",
            size: 0,
            key: path.toLowerCase(),
            ingest: () => Bridge.ingestFile(path),
          })),
        ];
        if (items.length === 0) {
          this.engine.animateMorph(0);
          this.setView(State.droppedFiles.length > 0 ? "choose" : State.defaultView());
          return;
        }
        this.swallow(items);
        break;
      }
    }
  }

  /**
   * Mochi eats the files. Nothing here waits on the file system: the copies into
   * the inbox run in the background and fill the paths in when they land, so a
   * slow disk can never stall the animation — same as FileDropHandler on macOS.
   * Files dropped while others wait to be asked about join them.
   */
  private swallow(items: DropItem[]) {
    // A conversation under way is about its own files: a new drop starts over.
    if (State.chatHistory.length > 0) {
      State.droppedFiles = [];
      State.chatHistory = [];
      void Bridge.chatReset();
    }
    State.dropError = null;
    State.promptContext = null;

    const same = (f: PendingFile, it: { key: string; name: string; size: number }) =>
      f.key === it.key || (it.size > 0 && f.name === it.name && f.size === it.size);
    const fresh: PendingFile[] = [];
    for (const it of items) {
      if (State.droppedFiles.some((f) => same(f, it)) || fresh.some((f) => same(f, it))) continue;
      const entry: PendingFile = { id: nextFileId++, name: it.name, path: "", size: it.size, key: it.key };
      entry.ready = it.ingest().then(
        (file) => {
          entry.path = file.path;
          entry.size = file.size;
          // The same file dropped once by path and once as bytes: keep the first.
          const twin = State.droppedFiles.find((f) => f !== entry && f.path && same(f, entry));
          if (twin) State.droppedFiles = State.droppedFiles.filter((f) => f !== entry);
          pushNotification({
            id: `drop-${entry.id}`,
            source: "Awuuu",
            title: t("File Dropped"),
            body: entry.name,
            timestamp: Date.now(),
            kind: "upload",
          });
          State.notify();
        },
        (err) => this.dropFailed(entry, err),
      );
      fresh.push(entry);
    }
    if (fresh.length === 0) {
      // Nothing new: straight back to the files that are already there.
      State.dropError = items.length > 1 ? t("Those files are already here.") : t("That file is already here.");
      this.engine.animateMorph(0);
      this.setView("choose");
      return;
    }
    State.droppedFiles = [...State.droppedFiles, ...fresh];
    State.uploadCount = fresh.length;

    // A drop with no drag-over before it (or onto a closed island) still gets
    // the whole sequence.
    this.openForDrop();
    if (!UploadSeq.isActive) {
      this.uploadCanvas.fit(this.viewsEl);
      UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
    }
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
  }

  /** A copy into the inbox failed: the file leaves the list, and the island says why. */
  private dropFailed(entry: PendingFile, err: unknown) {
    const why = String(err).replace(/^Error:\s*/, "");
    State.droppedFiles = State.droppedFiles.filter((f) => f !== entry);
    Sound.play("error");
    if (State.droppedFiles.length > 0) {
      // The others are fine: say it on their card.
      State.dropError = `${entry.name}: ${why}`;
      State.notify();
      return;
    }
    if (!DROP_VIEWS.has(State.view)) {
      State.notify();
      return;
    }
    UploadSeq.deactivate();
    this.showNote(why);
  }

  /**
   * Sounds and view changes hung off the canvas timeline: a `tick` every 10 %,
   * the ✓ chime when the bar completes, then `choose` — the files card, where
   * the island's own Awuuu grows back.
   */
  private stepSequence() {
    const since = UploadSeq.sinceDrop();
    if (since == null) return;
    const dur = State.uploadDuration;
    const p = Math.max(0, Math.min(1, (since - PRE_PROGRESS) / dur));

    // The island's own Awuuu waits where the canvas one is: at the end of the bar.
    State.uploadProgress = p;

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
    if (since >= PRE_PROGRESS + dur + HANDOVER && State.view === "uploading") {
      this.setView("choose");
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  private targetSize(): { w: number; h: number; radii: [number, number, number, number] } {
    // Being carried, the island is a droplet whatever it was.
    if (this.moveAt) {
      return {
        w: DROPLET,
        h: DROPLET,
        radii: [DROPLET / 2, DROPLET / 2, DROPLET / 2, DROPLET / 2],
      };
    }
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
    const edge = geo.layout.edge;
    const lift = onSide() ? this.sideGap(w) / SIDE_GAP : 0;
    const radii: [number, number, number, number] =
      edge === "top" ? [0, 0, r, r]
      : edge === "bottom" ? [r, r, 0, 0]
      : edge === "left" ? [r * lift, r, r, r * lift]
      : [r, r * lift, r * lift, r];
    return { w, h, radii };
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, radii } = this.targetSize();
    if (this.moveAt) {
      // Carrying: 0.42 response, 0.86 damping for <1% overshoot
      this.width.springTo(w, 0.42, 0.86);
      this.height.springTo(h, 0.42, 0.86);
      this.cornerTL.springTo(radii[0], 0.42, 0.86);
      this.cornerTR.springTo(radii[1], 0.42, 0.86);
      this.cornerBR.springTo(radii[2], 0.42, 0.86);
      this.cornerBL.springTo(radii[3], 0.42, 0.86);
    } else if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(h);
      this.cornerTL.curveTowards(radii[0]);
      this.cornerTR.curveTowards(radii[1]);
      this.cornerBR.curveTowards(radii[2]);
      this.cornerBL.curveTowards(radii[3]);
    } else {
      this.width.springTo(w);
      this.height.springTo(h);
      this.cornerTL.springTo(radii[0]);
      this.cornerTR.springTo(radii[1]);
      this.cornerBR.springTo(radii[2]);
      this.cornerBL.springTo(radii[3]);
    }
    this.ensureRunning();
  }

  private applyGeometry() {
    const w = this.width.value;
    const hh = this.height.value;
    const tl = clampCornerRadius(this.cornerTL.value, w, hh);
    const tr = clampCornerRadius(this.cornerTR.value, w, hh);
    const br = clampCornerRadius(this.cornerBR.value, w, hh);
    const bl = clampCornerRadius(this.cornerBL.value, w, hh);
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    const rect0 = this.islandRect();
    this.islandEl.style.transform = this.moveAt?.transform ?? "none";
    // The resize grip sits on the corner away from the docked edge.
    const L0 = geo.layout;
    const showGrip = State.mode === "expanded" && (State.view === "agents" || State.view === "prompt");
    this.resizeGrip.style.display = showGrip ? "block" : "none";
    this.resizeGrip.dataset.v = L0.v === "bottom" ? "bottom" : "top";
    this.resizeGrip.dataset.h = L0.h === "right" ? "left" : "right";
    // Keep the shadow margin transparent and limit the wake layer to the tab.
    this.wakeStrip.style.cssText = this.collapsed
      ? `left:${rect0.x}px;top:${rect0.y}px;width:${rect0.w}px;height:${rect0.h}px;transform:none;display:block`
      : "display:none";
    this.islandEl.style.left = `${rect0.x}px`;
    this.islandEl.style.top = `${rect0.y}px`;
    this.islandEl.style.bottom = "auto";
    this.islandEl.style.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`;

    // Top-corner ears: visible only when docked to top edge, square top corners, not moving
    const isMoving = !!this.moveAt || this.root.classList.contains("moving");
    const showEars = shouldShowEars(geo.layout.edge, isMoving, tl, tr);
    this.earLeft.style.display = showEars ? "block" : "none";
    this.earRight.style.display = showEars ? "block" : "none";
    if (showEars) {
      // Overlap the body by one pixel to avoid a transparent seam at fractional widths.
      const earSize = State.mode === "hidden" ? 5 : 14;
      this.earLeft.style.left = `${1 - earSize}px`;
      this.earLeft.style.top = "0px";
      this.earRight.style.left = `${w - 1}px`;
      this.earRight.style.top = "0px";
    }

    const lift = onSide() ? this.sideGap(w) / SIDE_GAP : 0;
    this.root.classList.toggle("floating", lift > 0.05);
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

    // Position agent column dots if active
    if (this.agentColumn.style.display !== "none") {
      const dots = this.agentColumn.children;
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i] as HTMLElement;
        const pos = agentColumnPosition(i, w, hh);
        dot.style.left = `${pos.x}px`;
        dot.style.top = `${pos.y}px`;
        dot.dataset.x = `${pos.x}`;
        dot.dataset.y = `${pos.y}`;
      }
    }

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
      const sw = L.vertical ? WAKE_STRIP_H : (L.edge === "top" ? TOP_STRIP_WINDOW_W : WAKE_STRIP_W);
      const sh = L.vertical ? WAKE_STRIP_W : (L.edge === "top" ? TOP_STRIP_WINDOW_H : WAKE_STRIP_H);
      const x = L.h === "left" ? 0 : L.h === "right" ? sw - w : (sw - w) / 2;
      const y = L.vertical ? (sh - hh) / 2 : L.v === "bottom" ? sh - hh : 0;
      return { x, y, w, h: hh };
    }
    if (onSide()) {
      // The pill stands against the edge; the open card floats beside it.
      // Both are centred on the pill's spot, kept inside the window.
      const gap = this.sideGap(w);
      const x = L.edge === "left" ? gap : L.panelW - w - gap;
      const y = Math.min(Math.max(L.anchorY - hh / 2, 0), Math.max(0, L.panelH - hh));
      return { x, y, w, h: hh };
    }
    const earMargin = L.edge === "top" ? 14 : 0;
    const minX = earMargin;
    const maxX = Math.max(minX, L.panelW - w - earMargin);
    const x = Math.min(Math.max(L.anchorX - w / 2, minX), maxX);
    return { x, y: this.atBottom ? L.panelH - hh : 0, w, h: hh };
  }

  /** Docked to a side: how far the island stands off the edge at width `w` —
   * nothing as a pill, SIDE_GAP once it has opened. */
  private sideGap(w: number): number {
    return SIDE_GAP * clamp((w - SIDE_COMPACT.w) / SIDE_LIFT, 0, 1);
  }

  /**
   * The corner grip (Agents hub, chat): drag to set the island's width and the
   * height of the hub or of the chat. Rust gives the window its largest size
   * meanwhile; the new size is saved on release, which fits the window to it
   * again. A double click on the chat's grip lets it grow with the
   * conversation again.
   */
  private wireResize() {
    const g = this.resizeGrip;
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      const chat = State.view === "prompt";
      const agents = State.view === "agents";
      const h = chat
        ? geo.chatH || chatPromptHeight(State.chatHistory.length)
        : agents
        ? (geo.agentsH > 0 ? geo.agentsH : geo.hubH)
        : geo.hubH;
      const initialW = onSide() ? geo.sideW : geo.expandedW;
      this.resizing = { sx: e.screenX, sy: e.screenY, w: initialW, h, chat, agents };
      State.isPinned = true;
      this.fsm.pinned = true;
      this.root.classList.add("resizing");
      void Bridge.islandResizeMode(true);
    });
    g.addEventListener("pointermove", (e) => {
      const r = this.resizing;
      if (!r) return;
      const L = geo.layout;
      const bounds = getOrientationBounds(L.edge);
      const dx = e.screenX - r.sx;
      const dy = e.screenY - r.sy;
      const dw = L.h === "center" ? 2 * dx : L.h === "left" ? dx : -dx;
      // A click on the grip is not a resize: the chat keeps growing by itself.
      if (r.chat && geo.chatH === 0 && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (r.agents && geo.agentsH === 0 && Math.abs(dx) + Math.abs(dy) < 3) return;
      const dh = L.v === "bottom" ? -dy : dy;
      const rawW = Math.round(r.w + dw);
      const rawH = Math.round(r.h + dh);
      const clampedW = Math.min(bounds.max.w, Math.max(bounds.min.w, rawW));
      const clampedH = Math.min(bounds.max.h, Math.max(bounds.min.h, rawH));
      if (onSide()) {
        geo.sideW = clampedW;
        if (r.chat) geo.chatH = clampedH;
        else if (r.agents) geo.agentsH = clampedH;
        else geo.hubH = clampedH;
      } else {
        geo.expandedW = clampedW;
        if (r.chat) geo.chatH = clampedH;
        else if (r.agents) geo.agentsH = clampedH;
        else geo.hubH = clampedH;
      }
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
      State.settings.chatHeight = geo.chatH;
      State.settings.agentsHeight = geo.agentsH;
      void Bridge.saveSettings(State.settings);
    };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
    g.addEventListener("dblclick", () => {
      if (State.view === "prompt") {
        if (geo.chatH === 0) return;
        geo.chatH = 0;
        State.settings.chatHeight = 0;
      } else if (State.view === "agents") {
        if (geo.agentsH === 0) return;
        geo.agentsH = 0;
        State.settings.agentsHeight = 0;
      } else {
        return;
      }
      void Bridge.saveSettings(State.settings);
      this.animateGeometry(true);
    });
  }

  /** The island grows up from its anchor (bottom edge, or low on the screen). */
  private get atBottom(): boolean {
    return geo.layout.v === "bottom";
  }

  /** Rust placed the window: draw the island where it now belongs. */
  setLayout(layout: IslandLayout) {
    geo.layout = { ...layout, anchorY: layout.anchorY ?? layout.panelH / 2 };
    this.moveAt = null;
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
      if (!this.moveAt) {
        void Bridge.setCollapsed(false);
      }
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
      this.hover.enter();
      if (State.mode === "hidden") {
        this.fsm.mouseEntered();
      }
    };

    this.wakeStrip.addEventListener("mouseenter", onEnter);
    this.islandEl.addEventListener("mouseenter", onEnter);

    this.islandEl.addEventListener("mouseleave", () => {
      this.wasInIsland = false;
      this.fsm.mouseLeft();
      this.hover.leave();
    });

    // A finish/error flash has played: take its class off (see syncGlow).
    this.islandEl.addEventListener("animationend", (e) => {
      if (e.animationName === "glow-flash") this.root.classList.remove("glow-done", "glow-error");
    });

    // Alt + press anywhere on the island moves it.
    this.islandEl.addEventListener("pointerdown", (e) => {
      if (e.altKey && e.button === 0) void this.mover.begin(e, this.islandEl);
      // A press on the dog in the open island may become a drag to the desktop.
      else if (
        e.button === 0 && State.mode === "expanded" && this.desktopDog.canPickUp() &&
        this.isBotHit(e.clientX, e.clientY)
      ) {
        this.dogPress = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener("pointermove", (e) => {
      const press = this.dogPress;
      if (!press || !isDrag(press, { x: e.clientX, y: e.clientY })) return;
      this.dogPress = null;
      this.cancelBotHover();
      this.desktopDog.pickUp();
    });
    const endPress = () => { this.dogPress = null; };
    window.addEventListener("pointerup", endPress);
    window.addEventListener("pointercancel", endPress);

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      this.hover.clicked();
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
      if (e.key === "Escape" && State.mode === "expanded" && State.view === "diff") this.setView("agents");
      else if (e.key === "Escape" && State.mode === "expanded" && !State.isPinned) this.collapse();
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
      if (this.fsm.state === "awuuu") this.greeting.hover();
      this.fsm.mouseEntered();
      this.hover.enter();
      this.homeCollapseAt = null;
    }
    if (!inIsland && this.wasInIsland) {
      this.fsm.mouseLeft();
      this.hover.leave();
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
    // On the desktop, the island's dog isn't here at all.
    if (this.desktopDog.away) return false;
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
    if (document.visibilityState !== "visible") {
      this.running = false;
      return;
    }
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.cornerTL.step(dt, nowMs);
    this.cornerTR.step(dt, nowMs);
    this.cornerBR.step(dt, nowMs);
    this.cornerBL.step(dt, nowMs);
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
        const w = this.width.value;
        const hh = this.height.value;
        const gw = Math.round(w * dpr);
        const gh = Math.round(hh * dpr);
        if (this.greetingCanvas.width !== gw || this.greetingCanvas.height !== gh) {
          this.greetingCanvas.width = gw;
          this.greetingCanvas.height = gh;
        }
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.fit(this.viewsEl, w, hh);
        this.greeting.draw(gctx);
      }
    } else {
      // Kept running even while the drop canvas is up, so the island's own Mochi
      // is already in the right place the moment the canvas fades out.
      this.drawBot(dt);
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) this.uploadCanvas.draw(this.viewsEl, nowMs / 1000);
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
      this.width.animating || this.height.animating ||
      this.cornerTL.animating || this.cornerTR.animating ||
      this.cornerBR.animating || this.cornerBL.animating;
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
    const p = this.moveAt
      ? { cx: this.width.value / 2, cy: this.height.value / 2, diameter: DROPLET / 2, opacity: 1 }
      : botPosition(State.mode, State.view, this.height.value, State.uploadProgress, this.width.value);
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    // The drop canvas draws its own Mochi; two of them would overlap.
    const visible = p.opacity > 0 && !greetingActive && !this.uploadActive && !this.desktopDog.away;
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

    // The Agents hub can dress Awuuu as the selected session's agent.
    const tapped = State.view === "agents" && State.mode === "expanded" ? State.focusedAgentSession : null;
    this.engine.setLook(tapped ? lookForAgent(tapped.source, tapped.color) : this.ownLook);
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
    return -Math.tanh((State.mouse.y - this.islandRect().y - this.botCy.value) / 200);
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

  /** The dog notices the move: a tail wag and a lean toward the new tab; ears up for an alert. */
  private reactToViewChange(dir: Direction) {
    if (REDUCED_MOTION.matches || dir === "none") return;
    if (dir === "up") {
      this.engine.earFlick();
    } else {
      const lean = dir === "forward" ? 0.12 : -0.12;
      this.engine.wagBurst(0.2, 4, 90);
      this.engine.lean(lean);
    }
    this.ensureRunning();
  }

  private syncDom() {
    const expanded = State.mode === "expanded";
    const greetingActive = expanded && State.view === "greeting";
    this.root.classList.toggle("music-home-active", expanded && State.view === "overview");

    this.contentEl.style.opacity = expanded && !greetingActive ? "1" : "0";
    this.contentEl.style.pointerEvents = expanded && !greetingActive ? "auto" : "none";
    this.greetingCanvas.style.display = greetingActive ? "block" : "none";

    this.header.sync();
    if (this.animView !== null && this.animView !== State.view) {
      // Only a change inside an open island slides; opening, closing and the
      // drop sequence (which draws itself) keep their own motion.
      const seq = DROP_VIEWS.has(State.view) && State.view !== "upload";
      const seqPrev = DROP_VIEWS.has(this.animView) && this.animView !== "upload";
      if (expanded && this.animExpanded && !greetingActive && !seq && !seqPrev && this.animView !== "greeting") {
        const dir = directionBetween(this.animView, State.view);
        const leaving = this.views.get(this.animView)?.el;
        const entering = this.views.get(State.view)?.el;
        if (leaving) animateView(leaving, false, dir);
        if (entering) animateView(entering, true, dir);
        this.reactToViewChange(dir);
      }
    }
    this.animView = State.view;
    this.animExpanded = expanded;
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }
    const activeView = this.views.get(State.view)?.el;
    const washCard = activeView?.querySelector<HTMLElement>(".card.wash");
    const wash = washCard?.style.getPropertyValue("--wash")
      || (State.view === "agents" ? activeView?.style.getPropertyValue("--agent-soft") : "")
      || "transparent";
    this.islandEl.style.setProperty("--view-wash", wash);

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

    // Right-hand agent dot column (views with agentMode: "column")
    const layout = VIEW_LAYOUTS[State.view];
    const isColumnMode = State.mode === "expanded" && layout?.agentMode === "column";
    const columnAgents = isColumnMode ? this.getColumnAgents() : [];
    const hasColumnAgents = columnAgents.length > 0;

    this.islandEl.classList.toggle("has-agent-column", hasColumnAgents);
    this.agentColumn.style.display = hasColumnAgents ? "block" : "none";

    if (hasColumnAgents) {
      const key = columnAgents.map((t) => `${t.id}:${t.state}:${t.color}`).join("|");
      if (this.agentColumn.dataset.key !== key) {
        this.agentColumn.dataset.key = key;
        this.agentColumn.replaceChildren();
        const w = this.width.value;
        const hh = this.height.value;
        for (let i = 0; i < columnAgents.length; i++) {
          const t = columnAgents[i];
          const dot = createMiniBot(t, 16);
          dot.classList.add("agent-dot");
          const pos = agentColumnPosition(i, w, hh);
          dot.style.left = `${pos.x}px`;
          dot.style.top = `${pos.y}px`;
          dot.dataset.x = `${pos.x}`;
          dot.dataset.y = `${pos.y}`;
          dot.title = t.name;
          dot.onclick = (e) => {
            e.stopPropagation();
            const session = State.agentSessions.find((s) => s.id === t.id);
            if (session) State.setAgentFocus(session.id);
            State.setFocus(t.id);
          };
          this.agentColumn.append(dot);
        }
        pruneMiniBots();
      }
    } else {
      if (this.agentColumn.dataset.key) {
        this.agentColumn.dataset.key = "";
        this.agentColumn.replaceChildren();
        pruneMiniBots();
      }
    }

    void this.syncCompactStrip();

    syncMiniBotStates(State.tasks);
    this.engine.setState(this.botState());
    this.syncGlow();
  }

  private getColumnAgents(): AgentTask[] {
    const focus = State.alertTask ?? State.focusedAgentSession ?? State.focusTask;
    return getColumnAgents(State.tasks, focus?.id) as AgentTask[];
  }

  /**
   * The ring around the island (style.css "Glow"): amber and pulsing while a
   * request waits for an answer, one green flash when a session finishes, a
   * red one with a shake when it fails. All CSS, driven from here by classes —
   * nothing runs once the request is answered or the flash has played.
   */
  private syncGlow() {
    this.root.classList.toggle("glow-wait", State.approvalQueue.length > 0);
    let flash: "glow-done" | "glow-error" | null = null;
    const seen = new Map<string, string>();
    for (const s of State.agentSessions) {
      const before = this.glowStates.get(s.id);
      if (before != null && before !== s.state) {
        if (s.state === "error") flash = "glow-error";
        else if (s.state === "finished") flash ??= "glow-done";
      }
      seen.set(s.id, s.state);
    }
    this.glowStates = seen;
    // A finished task calls the desktop dog home for a moment.
    if (flash === "glow-done") this.desktopDog.noteFinished();
    if (!flash || REDUCED_MOTION.matches) return;
    this.root.classList.remove("glow-done", "glow-error");
    void this.islandEl.offsetWidth; // restart the animation if one is still playing
    this.root.classList.add(flash);
    if (flash === "glow-done") {
      this.engine.hop();
      this.ensureRunning();
    }
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
    geo.expandedW = State.settings.islandWidth ?? 1000;
    geo.hubH = State.settings.hubHeight ?? 360;
    geo.chatH = State.settings.chatHeight ?? 0;
    geo.agentsH = State.settings.agentsHeight ?? 0;
    // The Appearance page edits the dog live; the frame loop picks it up.
    this.ownLook = normalizeLook(State.settings.dog);
    setOwnerLook(this.ownLook);
    setOutfitSelection(State.settings.outfit);
    this.desktopDog.settingsChanged();
    this.root.classList.toggle("at-bottom", this.atBottom);
    this.applyGeometry();
    this.animateGeometry(false);
    State.notify();
  }

  private onMediaChanged(info: NowPlaying | null) {
    const wasPlaying = !!this.compactMedia?.playing;
    const previousTitle = this.compactMedia?.title;
    const previousArtist = this.compactMedia?.artist;
    this.compactMediaReady = true;
    this.compactMedia = info?.active ? info : null;
    const key = this.compactMedia
      ? [this.compactMedia.sourceApp, this.compactMedia.title, this.compactMedia.artist, this.compactMedia.album].join("|")
      : "";
    const trackChanged = key !== this.compactTrackKey;
    if (trackChanged) {
      this.compactTrackKey = key;
      this.compactArtwork = null;
      if (key) void Bridge.mediaArtwork().then((artwork) => {
        if (this.compactTrackKey !== key) return;
        this.compactArtwork = artwork;
        this.lastCompactKey = "";
        void this.syncCompactStrip();
      });
    }
    if (trackChanged || wasPlaying !== !!this.compactMedia?.playing
      || previousTitle !== this.compactMedia?.title || previousArtist !== this.compactMedia?.artist) {
      this.lastCompactKey = "";
      void this.syncCompactStrip();
    }
  }

  private onSystemVolumeChanged(volume: SystemVolume) {
    this.volumeHud = volume;
    this.volumeHudUntil = Date.now() + 2300;
    this.lastCompactKey = "";
    if (this.volumeHudTimer != null) window.clearTimeout(this.volumeHudTimer);
    this.volumeHudTimer = window.setTimeout(() => {
      this.volumeHudTimer = null;
      this.volumeHudUntil = 0;
      this.lastCompactKey = "";
      void this.syncCompactStrip();
    }, 2300);
    if (State.mode !== "expanded") this.fsm.revealToast(2.5);
    void this.syncCompactStrip();
  }

  private renderCompactVolume(volume: SystemVolume) {
    const icon = svg(volume.muted ? ICONS.speakerOff : ICONS.speakerOn, 17);
    const fill = h("span", { class: "compact-volume-fill", style: `width:${volume.muted ? 0 : volume.level}%` });
    const bar = h("span", { class: "compact-volume-track" }, fill);
    const level = h("span", { class: "compact-volume-level", text: `${volume.level}%` });
    this.compactStrip.replaceChildren(h("div", { class: "compact-volume", role: "status", "aria-label": `${t("Volume")} ${volume.level}%` }, icon, bar, level));
    this.compactStrip.style.display = "flex";
  }

  /**
   * Synchronises live module indicators into the compact strip (media, timer).
   * Active only while the island is in compact mode; 0 % CPU while hidden or expanded.
   */
  private async syncCompactStrip() {
    if (State.mode !== "compact") {
      if (this.compactStrip) this.compactStrip.style.display = "none";
      if (this.compactMediaTimer != null) {
        window.clearInterval(this.compactMediaTimer);
        this.compactMediaTimer = null;
      }
      return;
    }

    if (this.volumeHud && Date.now() < this.volumeHudUntil) {
      if (this.lastCompactKey !== `volume:${this.volumeHud.level}:${this.volumeHud.muted}`) {
        this.lastCompactKey = `volume:${this.volumeHud.level}:${this.volumeHud.muted}`;
        this.renderCompactVolume(this.volumeHud);
      }
      return;
    }

    // 1. Live media if enabled in collapsed strip settings
    if (isModuleEnabled("media") && isModuleInCollapsedStrip("media")) {
      if (this.compactMediaTimer == null) {
        this.compactMediaTimer = window.setInterval(() => {
          if (State.mode !== "compact") return;
          void Bridge.nowPlaying().then((latest) => this.onMediaChanged(latest));
        }, 3500);
      }
      try {
        if (!this.compactMediaReady) {
          this.onMediaChanged(await Bridge.nowPlaying());
          return;
        }
        const info = this.compactMedia;
        if (State.mode !== "compact") return;
        if (info && info.active && info.playing) {
          this.compactStrip.style.display = "flex";
          const key = `media:${info.title}:${info.artist}:${info.playing}:${!!this.compactArtwork}`;
          if (this.lastCompactKey !== key) {
            this.lastCompactKey = key;
            this.renderCompactMedia(info);
          }
          return;
        }
      } catch {
        /* player query error ignored */
      }
    }

    if ((!isModuleEnabled("media") || !isModuleInCollapsedStrip("media")) && this.compactMediaTimer != null) {
      window.clearInterval(this.compactMediaTimer);
      this.compactMediaTimer = null;
    }

    // 2. Timer / Countdown if enabled in collapsed strip settings
    if (isModuleInCollapsedStrip("dashboard")) {
      const cdText = this.countdown.textContent?.trim();
      if (cdText) {
        this.compactStrip.style.display = "flex";
        const key = `timer:${cdText}`;
        if (this.lastCompactKey !== key) {
          this.lastCompactKey = key;
          const timerWrap = h(
            "div",
            { class: "compact-timer", title: t("Timer") },
            svg(ICONS.timer, 12),
            h("span", { text: cdText }),
          );
          timerWrap.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            this.alert("overview", true);
          });
          this.compactStrip.replaceChildren(timerWrap);
        }
        return;
      }
    }

    // None active: keep strip empty and hidden
    this.lastCompactKey = "";
    this.compactStrip.replaceChildren();
    this.compactStrip.style.display = "none";
  }

  private renderCompactMedia(info: NowPlaying) {
    const artIcon = this.compactArtwork
      ? h("img", { src: this.compactArtwork, alt: "" })
      : svg(ICONS.play, 10);
    const bars = h(
      "div",
      { class: "compact-media-bars" },
      h("span", { class: "bar bar-1" }),
      h("span", { class: "bar bar-2" }),
      h("span", { class: "bar bar-3" }),
    );
    const art = h("div", { class: "compact-media-art" }, artIcon);

    const title = h("span", { class: "compact-media-title", text: info.title });
    const infoBox = h("div", { class: "compact-media-info" }, art, title, bars);

    const prevBtn = h(
      "button",
      { class: "compact-media-btn", title: t("Previous"), "aria-label": t("Previous") },
      svg(ICONS.prev, 10),
    );
    const playBtn = h(
      "button",
      {
        class: "compact-media-btn",
        title: info.playing ? t("Pause") : t("Play"),
        "aria-label": info.playing ? t("Pause") : t("Play"),
      },
      svg(info.playing ? ICONS.pause : ICONS.play, 10),
    );
    const nextBtn = h(
      "button",
      { class: "compact-media-btn", title: t("Next"), "aria-label": t("Next") },
      svg(ICONS.next, 10),
    );

    prevBtn.addEventListener("click", async (e: Event) => {
      e.stopPropagation();
      try {
        await Bridge.mediaControl("prev");
        void this.syncCompactStrip();
      } catch {
        /* ignore */
      }
    });

    playBtn.addEventListener("click", async (e: Event) => {
      e.stopPropagation();
      try {
        await Bridge.mediaControl("play_pause");
        void this.syncCompactStrip();
      } catch {
        /* ignore */
      }
    });

    nextBtn.addEventListener("click", async (e: Event) => {
      e.stopPropagation();
      try {
        await Bridge.mediaControl("next");
        void this.syncCompactStrip();
      } catch {
        /* ignore */
      }
    });

    const controls = h("div", { class: "compact-media-controls" }, prevBtn, playBtn, nextBtn);

    const wrap = h(
      "div",
      { class: "compact-media", title: `${info.title} — ${info.artist}` },
      infoBox,
      controls,
    );
    wrap.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      this.alert("overview", true);
    });

    this.compactStrip.replaceChildren(wrap);
  }

  get panelSize() {
    return { w: geo.layout.panelW, h: geo.layout.panelH };
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
