# Awuuu (Windows) — guide for AI coding agents

Awuuu is a top-of-screen dynamic island AI dog companion for Windows: Awuuu the Dog, an animated character living at the top edge of your monitor, connects natively to your local Hermes Agent (:8642) while keeping an eye on Claude Code and AGY sessions and integrations. It allows approving permissions with 1-click, chatting with Hermes Agent, and dropping files directly from the island without switching focus.

## Where things are
- `windows/src/` — island frontend in TypeScript (no framework, Canvas 2D).
  - `windows/src/mochi/` — Awuuu character engine (`engine.ts`), launch greeting (`greeting.ts`), mini bots (`minibots.ts`).
  - `windows/src/island/` — FSM state machine (`fsm.ts`), hook receiver (`hooks.ts`), integrations (`integrations.ts`), DOM shell (`island.ts`).
  - `windows/src/views/` — island view components (overview, chat prompt, approval, upload/drop, settings, ticker).
  - `windows/src/settings/` — dedicated settings window.
  - `windows/src/core/` — springs/physics (`anim.ts`), IPC bridge (`bridge.ts`), layouts (`layout.ts`), WebAudio player (`sound.ts`), reactive store (`state.ts`).
- `windows/src-tauri/` — Rust backend (Tauri 2).
  - `windows/src-tauri/src/pipe.rs` — Named pipe server (`\\.\pipe\awuuu-<sid>`) for IPC with Claude Code / AGY hook.
  - `windows/src-tauri/src/hooks.rs` — Hook installer & `%USERPROFILE%\.claude\settings.json` safe updater.
  - `windows/src-tauri/src/win_user.rs` — Win32 window positioning, `WS_EX_NOACTIVATE`, multi-monitor DPI handling, SID retrieval.
  - `windows/src-tauri/src/secrets.rs` — Windows Credential Manager integration.
  - `windows/src-tauri/src/claude.rs` — Native Hermes Agent client (`http://127.0.0.1:8642`) with auto API_SERVER_KEY discovery, and Anthropic fallback.
  - `windows/src-tauri/src/integrations.rs` — Background pollers (GitHub, Stripe, n8n, Vercel, Resend, Notion, Cal.com).
- `windows/src/app/` — dashboard window; pure models live in `recap.ts` (turns, facts), `testcheck.ts` (did the tests pass), `handoff.ts` (note for another agent).
- `windows/src/core/markdown.ts` — the Markdown slice chat replies show (rendered by `views/markdown.ts`, text only, http(s) links only).
- `windows/src-tauri/src/ground.rs` + `island/ground.ts` — git snapshots at prompt/turn end, so history includes changes no tool call named.
- `windows/hook/` — source for `awuuu-hook.exe`, the lightweight CLI relay called by Claude Code.
- `shared/sounds/` — 28 royalty-free mathematically synthesized WAV audio assets.
- `scripts/gen_dog_sounds.py` — procedural sound generator.
- `windows/scripts/` — `gen-icons.mjs` (icon generator) and `pack.mjs` (packaging).

## Build & Run
- Dev with Tauri (live reload):
  ```powershell
  cd windows
  npm install
  npm run tauri dev
  ```
- Dev frontend only in browser:
  ```powershell
  cd windows
  npm run dev
  ```
- Build release installer:
  ```powershell
  cd windows
  npm run pack
  ```
- Pure-logic checks (node, no framework): `npm test` in `windows/`; Rust: `cargo test --lib` in `windows/src-tauri/`.
- Re-generate icons:
  ```powershell
  cd windows
  npm run icons
  ```
- Re-generate audio:
  ```powershell
  python scripts/gen_dog_sounds.py
  ```

## Rules
- **Windows Only**: Uses Tauri 2, Rust, Win32 APIs, MSVC, and HTML5 Canvas 2D.
- **Never block Claude Code / AGY**: If Awuuu is paused, closed, or slow, `awuuu-hook.exe` times out (300 ms) and exits cleanly with 0.
- **Safe settings modification**: Never overwrite `%USERPROFILE%\.claude\settings.json` directly. Always create a dated backup, compute diff, and write only after user confirmation.
- **Secure credentials**: Store API keys in Windows Credential Manager (`win_user`/`secrets.rs`), never on disk, config files, or git.
- **Performance & Focus**:
  - 0% CPU when hidden. `AudioContext` is suspended when idle.
  - Window must never steal focus from active applications (`WS_EX_NOACTIVATE`, `WS_EX_TOOLWINDOW`).
- **No telemetry**: 100% local operation with your local Hermes Agent.
- **Self-update** (`src-tauri/src/updater.rs`): the only call to a service the user didn't configure is the GitHub `latest.json` check, and it runs only after the user says yes (asked once at first launch, `updateCheck` setting) or clicks "Check for updates". Installers are minisign-signed; the private key lives in `%USERPROFILE%\.tauri\awuuu-updater.key`, never in git. Release with `npm run release -- <version> "notes"`.

## Credits & Attribution
- Forked from Coucou by Louis Raillé (https://github.com/Louis-CFM/coucou) under MIT License.
- Rebranded & customized for Hermes Agent with Awuuu the Dog character design and procedural audio by Thanawat (Owen).
