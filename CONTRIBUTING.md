# Contributing to Coucou

Thanks for wanting to help Mochi grow up! 🫶

## Getting started

Requirements: [Rust](https://rustup.rs), Node 20+, MSVC build tools (Visual Studio Build Tools with "Desktop development with C++").

```powershell
cd windows
npm install
npm run tauri dev
```

## Good first contributions

- A new integration (a poller in `src-tauri/src/integrations.rs` + an island card in `src/views/integrations.ts`).
- A new emote or sound for Mochi.
- Bug fixes — please describe how to reproduce.

## Rules of the house

- Rust + Tauri 2, Vanilla TypeScript on frontend.
- Secrets go in Windows Credential Manager, never on disk or in git.
- No telemetry, no network calls except to services the user configured.
- Never block Claude Code: if the app doesn't answer, the hook must exit right away.
- Never write `%USERPROFILE%\.claude\settings.json` without a backup and the user's confirmation.
- Keep it light: 0 % CPU when the island is hidden.

## Pull requests

- One topic per PR, with a short GIF or screenshot for anything visual.
- Build must pass with no new warnings (`npm run build`).
