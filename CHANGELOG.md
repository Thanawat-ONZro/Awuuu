# Changelog

What changed in each Awuuu version, in words a user can follow.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).
Plan for the next versions: [docs/ROADMAP.md](docs/ROADMAP.md).

## [Unreleased]

### Fixed
- The hook pipe drops a client that connects and sends nothing within 5 seconds, and refuses connections from other machines.

### Added
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
