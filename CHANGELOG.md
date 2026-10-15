# Changelog

What changed in each Awuuu version, in words a user can follow.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).
Plan for the next versions: [docs/ROADMAP.md](docs/ROADMAP.md).

## [Unreleased]

### Added
- Settings → General can pin the island to a specific display ("Display 1…N", counted from the left); an unplugged one falls back to the main display.
- Tray menu: "Wardrobe…" opens Appearance.

### Changed
- Moving the island: it now becomes a round droplet with just the dog while you carry it (instead of a small capsule), and rounds back into the pill when it docks.

### Changed
- The dog notices tab changes: a short tail wag and a lean toward the new tab, ears up when an alert rises, a hop when an agent finishes. Off with "reduce motion".
- The Awuuu window changes pages with a short ease-in, and its sidebar highlight slides to the open page.
- Switching tabs in the island now moves: the lit-tab highlight slides to the new tab (stretching a little on the way) and the new view slides in from the side of its tab, while alerts rise from below. With "reduce motion" on in Windows it is a short fade. Motion values live in `windows/src/core/motion.css` and `MOTION` in `anim.ts`.
- Colours now come from one place (`windows/src/core/tokens.css`, "Shiba Warm"). Waiting, done, error and info states use warmer colours named after the dog; the hard-coded copies in the island, dashboard and settings CSS now use them too.

### Fixed
- The hook pipe drops a client that connects and sends nothing within 5 seconds, and refuses connections from other machines.

### Added
- Thai and English UI (Settings → General → Language; Auto follows Windows). The island and the main Awuuu window pages are translated; Sessions, Stats, Welcome, About, the Composio card and the weekly card are only partly translated so far.
- Dog on the desktop (Settings → General, off by default): drag the dog out of the island and it sits on your desktop in its outfit, watching your cursor. Double-click it, press Ctrl+Alt+D or drop it on the island to send it home; it also flies home when an agent needs you and goes back afterwards. Its spot is remembered per monitor. Not yet tried on a real Windows desktop, see `docs/DESKTOP-DOG.md`.
- A thin coloured band tops each page of the Awuuu window, in the page's colour, with a few slow particles. It stands still with "reduce motion" or when the window is hidden.
- Weekly recap (Stats page, tray menu): sessions, files, commands, top agent and project, busiest day and longest session for the week from Monday, with a shareable image (save or copy). Lines changed and permissions answered show a dash, because that data is not recorded yet.
- Composio through Hermes (Integrations, off by default): adds Composio as an MCP server in Hermes's config after a diff, a backup and your confirmation. Your app data then goes through Composio's service; see `docs/HERMES-COMPOSIO.md`. The API key stays in Windows Credential Manager unless you also choose to write it to Hermes's `.env`.
- Shortcuts page (Awuuu window): rebind or turn off Ctrl+Alt+Space (open the chat from any app), Ctrl+Alt+A (go to the waiting question), Ctrl+Alt+T (open the session's terminal), Ctrl+Alt+S (mute) and Ctrl+Alt+I (open/close the island, off by default). Allow/Deny stay approval-only. A key another app already owns is reported in its row.
- Connect Gemini CLI and Cursor Agent from the Agents page, with the same backup, diff and confirm as Claude Code. Copilot CLI is not included yet.
- Click an edit in the session ticker to read its diff in the island (Esc goes back; an Open in VS Code button).
- Outfits for the dog (Settings → Appearance): party hat, witch hat, Santa hat, bow tie, sunglasses, flower crown, scarf, halo. Auto dresses the dog for the season.
- Open on hover (Settings → General, off by default): rest the pointer on the small island and it opens; it folds a moment after the pointer leaves unless you clicked inside.
- The accent colour follows the dog you pick (Settings → Appearance); the default Shiba keeps the caramel it always had, and every breed is kept readable on the dark island.
- With "reduce motion" on in Windows, all movement becomes a short fade and the looping animations stand still. The island also stops its frame loop while it is not visible.
- Questions from agents: at most 4 at once, with the answer-building logic tested.
- Your own sounds (Settings → General): put a file named like one of Awuuu's sounds (`finish.wav`, `approval.mp3` …) in the sounds folder and press "Reload sounds". Files that cannot be played fall back to the built-in sound.
- Quiet hours (Settings → General): no pop-ups or sounds when an agent finishes or asks something in the terminal. Approvals and errors still show, because an agent is waiting on them. Outside quiet hours, many agents finishing together make one pop-up instead of several.
- Any agent can talk to the island: point its hooks at `awuuu-hook --agent <name> <Event>` (for example `gemini` or `cursor`) with Claude Code-shaped JSON, and it shows under its own name in Sessions and history.
- Copy handoff (Sessions): a note another agent can continue from, with what was asked, what the previous agent claimed, what the history shows changed, how the tests stand and what failed.
- Check my setup (Settings → About, or `aw doctor`): which agents are connected, whether the hook relay is in place, whether Hermes answers, git and the aw command, each with what to do about it.
- Answer an approval card from the keyboard: Ctrl+Alt+Y allows, Ctrl+Alt+N denies (or hands a question back to the terminal). The keys are only taken while a card is waiting.
- Two agents, one file: when an agent is about to change a file another agent session changed in the last 3 minutes, the island says so (it never blocks the agent).
- Each request in Sessions and in copied recaps starts with one line of what really happened, such as "Changed 3 files (+42 −7) · tests failed 2× then passed · committed", with warnings like "Files changed after the last test run" or "Code changed, no tests were run".
- Test results are read from the output (cargo, vitest, jest, pytest, mocha, unittest, go, dotnet). A run with zero tests never counts as passed.
- Git confirms what a request changed: Awuuu compares `git status` from the start and end of each request, so edits made by `sed -i`, formatters or generators count too.
- "Ask Hermes" next to a test result Awuuu can't read gets a second opinion. It only runs when you click, and keys and e-mails are removed from what is sent.
- Awuuu has a personality in the chat: pick a tone (Playful, Calm or Professional) and the name it calls you by in Settings → Chat → Personality. It answers in your language and sounds natural in Thai. Hermes keeps its own memory.
- Chat answers show Markdown: bold, lists, headings, quotes and code blocks with a Copy button. Only web links (http/https) open; nothing from a reply is run as HTML.
- Chat awareness: Awuuu's answers know what the island sees (your agents and what they're doing, the next meeting, PRs waiting for review, what failed), so you can ask "what should I do next?" or "why did Claude fail?". By default this goes only to Hermes and models on your PC; change it in Settings → Privacy. E-mails, keys and your user folder are removed first.
- A dot in the chat header shows whether Hermes is answering (green), down (red) or missing its key (amber). While the chat is open Awuuu checks again on its own and says how to bring Hermes back; nothing is checked while the island is hidden.
- Frontend unit tests (vitest) for the live plan and the island's open/close logic; `npm test` runs them.

## [0.3.0] - 2026-10-03

- Agents hub with live plan and plan-limit chips, dashboard, settings, integrations sign-in, dog looks. See the git history for details.
