import { Bridge, onEvent, type NowPlaying, type SystemVolume } from "../core/bridge";
import { State } from "../core/state";
import { t } from "../i18n/i18n";
import { formatTime } from "../core/format";
import { displayedPosition } from "./music-timeline";
import { clear, h, svg } from "./dom";
import { ICONS } from "./icons";
import type { ViewHost } from "./views";
import "./music.css";

function accentFromArtwork(image: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 12;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "transparent";
  context.drawImage(image, 0, 0, 12, 12);
  const pixels = context.getImageData(0, 0, 12, 12).data;
  let best = [36, 36, 36];
  let bestScore = -1;
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = pixels.slice(i, i + 4);
    if (a < 200) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const score = (max - min) * Math.min(max, 210) / 255;
    if (score > bestScore) { best = [r, g, b]; bestScore = score; }
  }
  return `rgba(${best[0]}, ${best[1]}, ${best[2]}, 0.25)`;
}

function sourceLabel(source: string): string {
  const name = source.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? "";
  if (/spotify/i.test(name)) return "Spotify";
  if (/chrome/i.test(name)) return "Chrome";
  if (/firefox/i.test(name)) return "Firefox";
  if (/msedge|edge/i.test(name)) return "Edge";
  return name;
}

export function buildMusicHome(): ViewHost {
  const root = document.querySelector<HTMLElement>("#root");
  const artImage = h("img", { alt: "" });
  const art = h("div", { class: "music-art" }, artImage, h("span", { class: "music-art-fallback", "aria-hidden": "true", text: "♫" }));
  const title = h("div", { class: "music-title" });
  const artist = h("div", { class: "music-artist" });
  const source = h("div", { class: "music-source" });
  const elapsed = h("span", { class: "music-time" });
  const remaining = h("span", { class: "music-time" });
  const seek = h("input", { class: "music-seek", type: "range", min: 0, max: 1000, value: 0, "aria-label": "ตำแหน่งเพลง" }) as HTMLInputElement;
  const progress = h("div", { class: "music-progress" }, elapsed, seek, remaining);

  let current: NowPlaying | null = null;
  let sampledAt = 0;
  let trackKey = "";
  let refreshing = false;
  let refreshPending = false;
  let eventRevision = 0;
  let lastVolumeAt = 0;
  let scrubbing = false;
  let timelineTimer: number | null = null;
  let fallbackTimer: number | null = null;
  let renderedPlaying: boolean | null = null;

  const control = (path: string, label: string, action: "prev" | "play_pause" | "next") => {
    const button = h("button", { class: "music-control", title: label, "aria-label": label }, svg(path, 20));
    button.addEventListener("click", () => { void Bridge.mediaControl(action).then(() => refresh()); });
    return button;
  };
  const previous = control(ICONS.prev, "เพลงก่อนหน้า", "prev");
  const play = control(ICONS.play, "เล่นหรือหยุด", "play_pause");
  const next = control(ICONS.next, "เพลงถัดไป", "next");
  const transport = h("div", { class: "music-transport" }, previous, play, next);
  const volumeDown = h("button", { class: "music-volume-button", title: "ลดเสียง 5%", "aria-label": "ลดเสียง 5%", text: "−" });
  const mute = h("button", { class: "music-volume-button music-mute", title: "ปิดเสียง", "aria-label": "ปิดเสียง" }, svg(ICONS.speakerOn, 18));
  const volumeUp = h("button", { class: "music-volume-button", title: "เพิ่มเสียง 5%", "aria-label": "เพิ่มเสียง 5%", text: "+" });
  const volumeLevel = h("span", { class: "music-volume-level", text: "–" });
  const volumeControls = h("div", { class: "music-volume-controls" }, volumeDown, mute, volumeUp, volumeLevel);
  const controls = h("div", { class: "music-controls" }, transport, volumeControls);
  const main = h("div", { class: "music-main" },
    h("div", { class: "music-cover-column" }, art),
    h("div", { class: "music-detail" }, source, title, artist, progress, controls),
  );
  const empty = h("div", { class: "music-empty", text: t("No music playing") });
  const surface = h("div", { class: "music-surface" }, empty, main);
  const el = h("div", { class: "view music-home" }, surface);

  function renderVolume(value: SystemVolume | null) {
    if (!value) return;
    volumeLevel.textContent = `${value.level}%`;
    clear(mute);
    mute.append(svg(value.muted ? ICONS.speakerOff : ICONS.speakerOn, 18));
    mute.title = value.muted ? "เปิดเสียง" : "ปิดเสียง";
    mute.setAttribute("aria-label", mute.title);
    mute.setAttribute("aria-pressed", String(value.muted));
    lastVolumeAt = Date.now();
  }

  async function refreshVolume() {
    renderVolume(await Bridge.systemVolume());
  }
  volumeDown.addEventListener("click", () => { void Bridge.changeSystemVolume(-5).then(renderVolume); });
  volumeUp.addEventListener("click", () => { void Bridge.changeSystemVolume(5).then(renderVolume); });
  mute.addEventListener("click", () => { void Bridge.toggleSystemMute().then(renderVolume); });

  function renderTimeline() {
    if (!current) return;
    const duration = Math.max(0, current.durationMs ?? 0);
    const position = displayedPosition(current.positionMs ?? 0, duration, current.playing, sampledAt, Date.now());
    if (!scrubbing) {
      elapsed.textContent = formatTime(position);
      remaining.textContent = duration ? `−${formatTime(duration - position)}` : "0:00";
      seek.value = duration ? String(Math.round(position / duration * 1000)) : "0";
      seek.style.setProperty("--music-progress", `${duration ? position / duration * 100 : 0}%`);
    }
    seek.disabled = !current.canSeek || !duration;
    if (renderedPlaying !== current.playing) {
      renderedPlaying = current.playing;
      clear(play);
      play.append(svg(current.playing ? ICONS.pause : ICONS.play, 20));
      play.title = current.playing ? "หยุดชั่วคราว" : "เล่น";
      play.setAttribute("aria-label", play.title);
    }
  }

  function loadArtwork(key: string) {
    void Bridge.mediaArtwork().then((artwork) => {
      if (!artwork || trackKey !== key) return;
      artImage.onload = () => {
        if (trackKey !== key) return;
        art.classList.add("has-art");
        try { root?.style.setProperty("--music-tint", accentFromArtwork(artImage)); }
        catch { root?.style.setProperty("--music-tint", "transparent"); }
      };
      artImage.onerror = () => art.classList.remove("has-art");
      artImage.src = artwork;
    });
  }

  function applySnapshot(info: NowPlaying | null) {
      if (!info?.active) {
        current = null;
        trackKey = "";
        surface.classList.remove("has-media");
        root?.style.setProperty("--music-tint", "transparent");
        return;
      }
      current = info;
      sampledAt = Date.now();
      surface.classList.add("has-media");
      const key = [info.sourceApp, info.title, info.artist, info.album, Math.round((info.durationMs ?? 0) / 1000)].join("|");
      if (key !== trackKey) {
        trackKey = key;
        artImage.removeAttribute("src");
        art.classList.remove("has-art");
        root?.style.setProperty("--music-tint", "transparent");
        loadArtwork(key);
      }
      title.textContent = info.title;
      artist.textContent = info.artist;
      source.textContent = sourceLabel(info.sourceApp);
      renderTimeline();
      if (Date.now() - lastVolumeAt > 3_000) void refreshVolume();
  }

  async function refresh() {
    if (State.view !== "overview" || State.mode !== "expanded") return;
    if (refreshing) { refreshPending = true; return; }
    refreshing = true;
    const revision = eventRevision;
    try {
      const info = await Bridge.nowPlaying();
      if (revision === eventRevision) applySnapshot(info);
    } finally {
      refreshing = false;
      if (refreshPending) { refreshPending = false; void refresh(); }
    }
  }

  seek.addEventListener("pointerdown", () => { scrubbing = true; });
  seek.addEventListener("input", () => {
    if (!current?.durationMs) return;
    const position = Math.round(Number(seek.value) / 1000 * current.durationMs);
    elapsed.textContent = formatTime(position);
    remaining.textContent = `−${formatTime(current.durationMs - position)}`;
    seek.style.setProperty("--music-progress", `${Number(seek.value) / 10}%`);
  });
  seek.addEventListener("change", () => {
    scrubbing = false;
    if (!current?.canSeek || !current.durationMs) return;
    const position = Math.round(Number(seek.value) / 1000 * current.durationMs);
    void Bridge.mediaSeek(position).then(() => refresh());
  });

  // Windows events drive track/state changes; this slower check covers players
  // that do not report all events and an event watcher that could not start.
  void onEvent<NowPlaying | null>("media-changed", (info) => {
    eventRevision++;
    if (State.view === "overview" && State.mode === "expanded") applySnapshot(info);
  });
  void onEvent<SystemVolume>("system-volume-changed", renderVolume);
  function updateTimers() {
    if (typeof window.setInterval !== "function") return;
    const open = State.view === "overview" && State.mode === "expanded";
    if (open && timelineTimer === null) {
      timelineTimer = window.setInterval(renderTimeline, 100);
      fallbackTimer = window.setInterval(() => { void refresh(); void refreshVolume(); }, 3_500);
    } else if (!open && timelineTimer !== null) {
      window.clearInterval(timelineTimer);
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      timelineTimer = fallbackTimer = null;
    }
  }
  State.subscribe(updateTimers);
  return { el, sync() {
    empty.textContent = t("No music playing");
    updateTimers(); void refresh(); void refreshVolume();
  } };
}
