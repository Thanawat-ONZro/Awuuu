// The Awuuu window: a sidebar on the left, one page on the right.
//
// A page is a file in pages/ exporting `page()`; it is rebuilt every time it is
// opened, so what it shows is never stale. Add a page by adding it to PAGES.

import { h, svg, clear } from "../views/dom";
import { MOTION } from "../core/anim";
import { page as sessionsPage } from "./pages/sessions";
import { page as statsPage } from "./pages/stats";
import { page as welcomePage } from "./pages/welcome";
import { page as agentsPage } from "./pages/agents";
import { page as chatPage } from "./pages/chat";
import { page as integrationsPage } from "./pages/integrations";
import { page as appearancePage } from "./pages/appearance";
import { page as islandPage } from "./pages/island";
import { page as generalPage } from "./pages/general";
import { page as shortcutsPage } from "./pages/shortcuts";
import { page as privacyPage } from "./pages/privacy";
import { page as aboutPage } from "./pages/about";

export type PageId =
  | "sessions" | "stats"
  | "welcome" | "agents" | "chat" | "integrations"
  | "appearance" | "island" | "general" | "shortcuts"
  | "privacy" | "about";

interface PageDef {
  id: PageId;
  label: string;
  /** 24×24 outline path. */
  icon: string;
  build: () => HTMLElement | Promise<HTMLElement>;
}

const I = {
  sessions: "M4 6h16M4 12h16M4 18h10",
  stats: "M5 20V11M12 20V4M19 20v-6",
  welcome: "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.4l6-.8L12 3z",
  agents: "M4 6h16v12H4zM8 10l3 2-3 2M13 14h3",
  chat: "M4 5h16v11H9l-5 4V5z",
  integrations: "M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v3",
  appearance: "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.2 3H15a2 2 0 0 0-1.5 3.3c.6.7.1 2.7-1.5 2.7zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  island: "M3 5h18v14H3zM8 5v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5",
  general: "M11 5 6.5 8.5H3.5v7h3L11 19V5zM15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11",
  shortcuts: "M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8",
  privacy: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3zM9 12l2 2 4-4",
  about: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5h.01",
};

const GROUPS: { title: string; pages: PageDef[] }[] = [
  {
    title: "Activity",
    pages: [
      { id: "sessions", label: "Sessions", icon: I.sessions, build: sessionsPage },
      { id: "stats", label: "Stats & limits", icon: I.stats, build: statsPage },
    ],
  },
  {
    title: "Set up",
    pages: [
      { id: "welcome", label: "Getting started", icon: I.welcome, build: welcomePage },
      { id: "agents", label: "Agents", icon: I.agents, build: agentsPage },
      { id: "chat", label: "Chat & models", icon: I.chat, build: chatPage },
      { id: "integrations", label: "Integrations", icon: I.integrations, build: integrationsPage },
    ],
  },
  {
    title: "Look & feel",
    pages: [
      { id: "appearance", label: "Appearance", icon: I.appearance, build: appearancePage },
      { id: "island", label: "Island", icon: I.island, build: islandPage },
      { id: "general", label: "Sound & behaviour", icon: I.general, build: generalPage },
      { id: "shortcuts", label: "Shortcuts", icon: I.shortcuts, build: shortcutsPage },
    ],
  },
  {
    title: "Awuuu",
    pages: [
      { id: "privacy", label: "Privacy & history", icon: I.privacy, build: privacyPage },
      { id: "about", label: "About & aw", icon: I.about, build: aboutPage },
    ],
  },
];

const PAGES = GROUPS.flatMap((g) => g.pages);

let appVersion = "";
let currentId: PageId | null = null;
let seq = 0;
let content: HTMLElement;
let thumb: HTMLElement | null = null;
let thumbY: number | null = null;
let pageAnim: Animation | null = null;
let shown = false;
const navButtons = new Map<PageId, HTMLElement>();
const leaveHandlers: (() => void)[] = [];

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slides the sidebar highlight to the active item; it stretches while it travels. */
function moveSideThumb() {
  const b = currentId ? navButtons.get(currentId) : undefined;
  if (!thumb || !b) return;
  const fromY = thumbY ?? b.offsetTop;
  const toY = b.offsetTop;
  thumbY = toY;
  thumb.style.height = `${b.offsetHeight}px`;
  thumb.style.transform = `translateY(${toY}px)`;
  if (fromY === toY || reduced() || typeof thumb.animate !== "function") return;
  thumb.getAnimations().forEach((a) => a.cancel());
  const mid = (fromY + toY) / 2;
  thumb.animate(
    [
      { transform: `translateY(${fromY}px) scaleY(1)` },
      { transform: `translateY(${mid}px) scaleY(${1 + Math.min(0.6, Math.abs(toY - fromY) / 120)})`, offset: 0.45 },
      { transform: `translateY(${toY}px) scaleY(1)` },
    ],
    { duration: MOTION.base + 20, easing: MOTION.spring },
  );
}

export function version(): string {
  return appVersion;
}

export function currentPage(): PageId | null {
  return currentId;
}

/** A page registers what to stop (timers, listeners) when it is left. */
export function onLeave(fn: () => void) {
  leaveHandlers.push(fn);
}

/**
 * Opens a page; `anchor` is the id of a card to bring into view and flash
 * (`agent-claude`, …).
 */
export async function navigate(id: PageId, anchor?: string) {
  const def = PAGES.find((p) => p.id === id) ?? PAGES[0];
  const mine = ++seq;
  for (const fn of leaveHandlers.splice(0)) {
    try {
      fn();
    } catch {
      /* a page's clean-up must never block navigation */
    }
  }
  currentId = def.id;
  navButtons.forEach((b, k) => b.classList.toggle("on", k === def.id));
  moveSideThumb();
  try {
    localStorage.setItem("awuuu_page", def.id);
  } catch {
    /* private mode */
  }
  let el: HTMLElement;
  try {
    el = await def.build();
  } catch (err) {
    el = h("div", { class: "page" }, h("div", { class: "notice err", text: `This page could not load: ${String(err)}` }));
  }
  if (mine !== seq) return; // another page was opened meanwhile
  clear(content);
  content.append(el);
  content.scrollTop = 0;
  // The first page of a session appears without motion; later ones ease in.
  // Navigation never waits on this animation.
  const animate = shown && typeof el.animate === "function";
  shown = true;
  if (animate) {
    pageAnim?.cancel();
    const from = reduced()
      ? { opacity: 0 }
      : { opacity: 0, transform: "translateY(8px)" };
    const to = reduced() ? { opacity: 1 } : { opacity: 1, transform: "translateY(0)" };
    pageAnim = el.animate([from, to], {
      duration: reduced() ? MOTION.fast : MOTION.base,
      easing: reduced() ? MOTION.out : MOTION.spring,
    });
  }
  if (anchor) {
    const target = document.getElementById(anchor);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("flash");
      window.setTimeout(() => target.classList.remove("flash"), 1600);
    }
  }
}

/** `settings-focus` payloads: a page id, "welcome", or an agent id. */
export function navigateFromEvent(target: string) {
  if (PAGES.some((p) => p.id === target)) void navigate(target as PageId);
  else if (target === "dashboard") void navigate("sessions");
  else if (target === "settings") void navigate(currentId ?? "agents");
  else void navigate("agents", `agent-${target}`);
}

export function mountShell(root: HTMLElement, ver: string, first: PageId) {
  appVersion = ver;
  thumb = h("div", { class: "side-thumb", "aria-hidden": "true" });
  thumbY = null;
  const nav = h("nav", { class: "side" },
    thumb,
    h("div", { class: "brand" },
      h("span", { class: "brand-dog", text: "🐶" }),
      h("span", { class: "brand-name", text: "Awuuu" }),
      h("span", { class: "brand-ver", text: ver }),
    ),
  );
  for (const g of GROUPS) {
    nav.append(h("div", { class: "side-group", text: g.title }));
    for (const p of g.pages) {
      const b = h("button", { class: "side-item", onclick: () => void navigate(p.id) },
        svg(p.icon, 15, { stroke: 1.8 }), h("span", { text: p.label }));
      navButtons.set(p.id, b);
      nav.append(b);
    }
  }
  content = h("main", { class: "content" });
  clear(root);
  root.append(nav, content);
  void navigate(first);
}
