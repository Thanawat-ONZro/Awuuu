<div align="center">

<img src="windows/src-tauri/icons/icon.png" width="96" alt="Awuuu icon">

# Awuuu 🐾

**A small Windows island for music, files, notes and coding agent activity.**
*Use the local tools immediately. Connect an agent, chat provider or online service only when you want it.*

Control the music playing on your PC, keep temporary files close, and follow coding agent sessions from the edge of your screen.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![TypeScript](https://img.shields.io/badge/TypeScript-vanilla-3178C6?logo=typescript&logoColor=white)
![Canvas 2D](https://img.shields.io/badge/Canvas-60fps-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 🐶 Meet Awuuu

**Awuuu** is an expressive, adorable dog companion (บางทีก็หมาต๋อง, หมาป่า, หมาบ้า, หมาน่ารัก) that peeks out from the top edge of your screen. Awuuu has animated floppy/perky ears with spring physics, a wagging tail, a cute black snout, a panting tongue (blep), and an expressive howling mouth when excited!

### Optional local chat

If you already run Hermes Agent on this PC, Awuuu can connect to its local gateway at `http://127.0.0.1:8642`. Chat is optional; music, notes, to-dos and Shelf do not need Hermes. Cloud chat providers are also optional and may have their own costs.

---

## ✨ Features and setup effort

| Feature | To start | Internet |
| --- | --- | --- |
| Music controls, volume, notes, to-dos, quick toggles | Open the island; play music in a Windows media app to see its controls | No for Awuuu's local controls |
| Shelf (temporary files) | Drop a file onto the island or Shelf; copies are kept locally for seven days | No |
| Clipboard history | Open **Shelf → Clipboard**; automatically collects copied text/images; search, filter, copy or delete | No; up to 50 items, session only; pause in Privacy & history |
| Encrypted file sharing | Open **Shelf → Files → Share**, then upload and copy a link or scan the QR | Requires the Awuuu-operated sharing service; disabled in builds without a deployed endpoint |
| Coding agent sessions and approvals | Install a supported agent, then connect its hook once in **Get started → Agents** | The agent may need internet; Awuuu's hook is local |
| Weather | Enter a city in **Features → Integrations** or **Features → Modules** | Yes; no API key |
| Calendar | Paste a private iCal link in **Features → Integrations**; account connection is optional | Yes |
| Mail | Connect Google or Microsoft, or use an app password on the Mail card | Yes; provider setup required |
| Translation | Configure a running local LibreTranslate service or add a DeepL/Google API key in **Features → Modules** | Depends on provider |
| Hermes or another chat provider | Open **Get started → Chat & models**, choose a provider and test it | Depends on provider |
| Developer services (GitHub, Stripe, Vercel and others) | Open **Features → Integrations**; connect only what you use | Yes |

Awuuu does not require an account for local features. Tokens and API keys entered in the app are stored in Windows Credential Manager. Online integrations contact the providers you configure; see **Privacy & history** in Settings for details.

---

## 🚀 Install and use

1. On Windows 10/11, download the Windows installer from this project's [Releases](https://github.com/Thanawat-ONZro/Awuuu/releases) and run it. You do not need Rust, Node.js, Visual Studio Build Tools or Hermes to use the local features.
2. Open Awuuu from Start or the tray. Hover the small tab at the screen edge, then click to open the island.
3. Try music, notes, to-dos or Shelf. Open **Features → Modules** to show, hide or reorder what appears.
4. If you use a coding agent, open **Get started → Agents**, choose a detected agent, review the hook change and click **Set up**. Restart the agent if its page asks you to.
5. Add online features only when needed. **Features → Integrations** lists the no-account options first, followed by calendar, mail, GitHub and advanced services.

### Shortest setup for online features

1. **Weather:** Enter a city and choose a temperature unit in **Integrations → No account needed**. In **Modules**, turn Weather on if you want its island card. No account or API key is needed.
2. **Calendar:** Copy your calendar's private iCal/ICS address and paste it into **Integrations → Calendar & mail → Calendar**. Keep the address private. In **Modules**, turn Calendar on. Google and Microsoft account sign-in is an optional alternative that currently requires creating your own OAuth client ID; [follow these steps](docs/OAUTH-SETUP.md) only if you need account access.
3. **Mail:** In **Integrations → Calendar & mail**, choose Google or Microsoft. Those buttons guide you to the one-time OAuth app setup. If your provider supports app passwords, **Mail → Mail with an app password** is an alternative. Never enter your normal account password there.
4. **Translation:** In **Modules → Translation · provider setup**, choose an already-running local LibreTranslate service, or save a DeepL/Google key. Then turn Translation on. It is off on a new installation until a provider is configured.
5. **GitHub:** If GitHub CLI (`gh`) is already installed and signed in, use **Integrations → GitHub → Use GitHub CLI login**. Otherwise, the code sign-in needs a client ID; a personal access token is on the same GitHub card.

Calendar and Translation are off for new installations until configured. Existing users keep their saved module choices. If you only need local features, you can skip this entire online setup.

### Costs and usage

Each provider card includes **Cost & usage limits**. Google OAuth requests consume the project's API quota. Standard Gmail/Calendar API use has no additional charge, but Google documents Calendar billing thresholds and announced changes for excess usage; [check its current limits](https://developers.google.com/workspace/calendar/api/guides/quota). Other Google Cloud products have separate pricing. Private iCal feeds do not use your Google Cloud API project.

Cloud chat and translation can incur provider API charges. A local Hermes gateway can also call a paid cloud model. Check the selected model and provider plan before entering a key. Connecting a developer service does not remove its existing subscription or usage fees.

Setup forms show whether values are unsaved, saving or saved on this PC. **Saved** confirms storage; use **Test** to check the connection. Illustrated examples contain anonymized screenshots and can be enlarged from their setup panel.

### Clipboard and file sharing

Clipboard history starts automatically by default; pause it in **Privacy & history**. An explicitly saved pause is respected. It uses Windows change notifications, supports text and bitmap/PNG images, and keeps at most 50 entries within a 20 MB budget. Entries expire after 24 hours and are cleared when Awuuu closes. Password-manager exclusion formats are respected. Clipboard history is not uploaded.

Files stay local until you explicitly press **Upload encrypted file**. Sharing encrypts filename and content before upload, accepts files up to 25 MB, and gives a 24-hour link and QR. Receivers only need a browser. Complete links contain the decryption key; keep them private. You can revoke a link from **Active share links**, including after restarting Awuuu. Copies already downloaded remain with the recipient.

Offline use keeps Shelf and Clipboard available and disables uploading. A build without the project service displays an unavailable badge. The service is operated by the project; end users do not install or configure Cloudflare. Operator deployment, budgets and costs are documented in [services/share/README.md](services/share/README.md).

For an actual read-only connection check, open **About & aw → Saved connections → Test saved connections**. Services without saved credentials are skipped. Success means the service answered a real read request, not simply that a key was stored.

## 🧰 Build from source (contributors)

Prerequisites: [Rust](https://rustup.rs), [Node.js 20+](https://nodejs.org), Visual Studio Build Tools with **Desktop development with C++**, and Windows 10/11 with WebView2. Hermes is needed only to exercise local chat.

```powershell
cd windows
npm install
npm run tauri dev    # Launch live dev mode
```

To build a production standalone installer:

```powershell
npm run pack         # NSIS installer generated in windows/release/
```

To publish a version that installed copies update to by themselves (needs the
signing key in `%USERPROFILE%\.tauri\awuuu-updater.key` and `gh` logged in):

```powershell
npm run release -- 0.3.0 "What changed"
```

`npm run dev` alone serves the front end in a normal browser (no Tauri), handy
for UI work. The app log lives in `%LOCALAPPDATA%\Awuuu\awuuu.log`.

---

## 🛠️ Where settings live

Open **Settings…** from the Awuuu tray icon. **Getting started** covers agents and chat; **Features** covers island modules and external integrations; **Personalize** covers appearance, island position, sounds and shortcuts; **Privacy & history** shows what leaves this PC. Each provider has one setup location on its own card. Other services holds optional developer integrations.

---

## 🏗️ Architecture

```
                       ┌────────────────────────┐
                       │   Windows Top Island   │
                       │ (Awuuu Canvas 2D + UI) │
                       └───────────▲────────────┘
                                   │ IPC (Tauri 2)
                       ┌───────────▼────────────┐
                       │      Awuuu Backend     │
                       │     (Rust / Win32)     │
                       └─────┬────────────┬─────┘
                             │            │
            Named Pipe       │            │ Local HTTP REST
   \\.\pipe\awuuu-<sid>      │            │ http://127.0.0.1:8642
                             ▼            ▼
                     ┌──────────────┐   ┌───────────────────────────┐
                     │  awuuu-hook  │   │  Local Hermes Agent (:8642)│
                     │  (Claude /   │   │  - NSSM HermesGateway     │
                     │   AGY Relay) │   │  - Memories, Skills, Tools│
                     └──────────────┘   └───────────────────────────┘
```

- **Island Window**: Borderless, transparent Tauri 2 window with Win32 `WS_EX_TOOLWINDOW` and `WS_EX_NOACTIVATE` so it never steals focus from your IDE or terminal.
- **Relay**: Ultra-fast `awuuu-hook.exe` communicating over local named pipes (`\\.\pipe\awuuu-<sid>`). Never blocks Claude Code sessions (300ms timeout fallback).
- **Procedural Sound Engine**: 28 custom audio waveforms synthesized mathematically in `scripts/gen_dog_sounds.py`.

---

## 🙏 Credits & Attribution

- **Original Project**: Forked and reimagined from [Coucou](https://github.com/Louis-CFM/coucou) by **Louis Raillé** ([louisraille.fr](https://louisraille.fr)), licensed under the **MIT License**.
- **Awuuu Customization**: Rebranded and extended by **Thanawat (Owen)** to support native Hermes Agent integration, the new Awuuu the Dog character design, procedural sound system, and custom icon set.
- Respecting the [LICENSE-ASSETS.md](LICENSE-ASSETS.md) guidelines: Awuuu features a completely original character design, new name, custom icons, and fresh open-source audio.

---

## 📄 License

- **Code:** [MIT License](LICENSE) © 2026 Thanawat & Louis Raillé.
- **Character, Icons, and Audio:** MIT License © 2026 Thanawat.
