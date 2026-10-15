// SoundEngine
// The 28 WAVs live in shared/sounds (see SOUNDS_DIR in vite.config.ts);
// they are served at /sounds/<name>.wav. Default volume 0.12, slider range 0–0.2,
// and several sounds may overlap.
// A file of the user's own in %APPDATA%\Awuuu\sounds named like a sound
// (finish.mp3, greet.m4a…) replaces the bundled one (src-tauri/src/sounds.rs).
// A file that will not decode falls back to the bundled sound.

import { Bridge } from "./bridge";

export const SOUND_NAMES = [
  "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "work", "finish", "error", "approval", "question", "approve", "gulp", "tick",
  "send", "love", "pop", "proud", "wink", "yawn", "attach", "think", "search",
  "rate", "sleep",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

class SoundEngine {
  enabled = true;
  volume = 0.12;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private idleTimer: number | null = null;
  private generation = 0;

  /** Creates the context and decodes every sound. Safe to call more than once. */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.master = master;
      await this.decodeAll();
    })();
    return this.loading;
  }

  /**
   * Settings → Reload sounds: reads the sounds folder again. Decoding does not
   * start the context, so this never wakes an idle island. Sounds keep playing
   * from the old buffers until the new set is ready.
   */
  async reload(): Promise<void> {
    await this.loading;
    await this.decodeAll();
  }

  private async decodeAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const generation = ++this.generation;
    const found = await Bridge.userSounds(SOUND_NAMES);
    const custom = new Set(found?.custom ?? []);
    const next = new Map<string, AudioBuffer>();
    await Promise.all(
      SOUND_NAMES.map(async (name) => {
        const buf =
          (custom.has(name) ? await this.decodeUser(ctx, name) : null) ?? (await this.decodeBundled(ctx, name));
        if (buf) next.set(name, buf);
      }),
    );
    // A newer reload has started since: its result is the one to keep.
    if (generation === this.generation) this.buffers = next;
  }

  private async decodeUser(ctx: AudioContext, name: string): Promise<AudioBuffer | null> {
    try {
      const bytes = await Bridge.userSound(name);
      if (!bytes) return null;
      return await ctx.decodeAudioData(bytes);
    } catch {
      return null;
    }
  }

  private async decodeBundled(ctx: AudioContext, name: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(`/sounds/${name}.wav`);
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      /* a missing sound must never break the island */
      return null;
    }
  }

  /** WebView2 can hand us a suspended context; call after any user input. */
  resume() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    void this.ctx?.resume();
  }

  /**
   * Called when the island goes quiet. A running AudioContext keeps an audio
   * thread and its render quantum alive even with nothing playing, which shows
   * up as a steady trickle of CPU on a machine that is supposed to be idle.
   *
   * The delay covers the tail of whatever just played — suspending mid-sound
   * would clip it — and `play()` resumes the context on its own.
   */
  idle() {
    if (!this.ctx || this.ctx.state !== "running" || this.idleTimer != null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      void this.ctx?.suspend();
    }, 1500);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(0.2, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  play(name: SoundName | string) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.buffers.get(name);
    if (!ctx || !master || !buf) return;
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
  }
}

export const Sound = new SoundEngine();
