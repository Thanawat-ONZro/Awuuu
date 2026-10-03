# Changelog

What changed in each Awuuu version, in words a user can follow.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).
Plan for the next versions: [docs/ROADMAP.md](docs/ROADMAP.md).

## [Unreleased]

### Added
- Awuuu has a personality in the chat: pick a tone (Playful, Calm or Professional) and the name it calls you by in Settings → Chat → Personality. It answers in your language and sounds natural in Thai. Hermes keeps its own memory.
- Chat answers show Markdown: bold, lists, headings, quotes and code blocks with a Copy button. Only web links (http/https) open; nothing from a reply is run as HTML.
- Chat awareness: Awuuu's answers know what the island sees (your agents and what they're doing, the next meeting, PRs waiting for review, what failed), so you can ask "what should I do next?" or "why did Claude fail?". By default this goes only to Hermes and models on your PC; change it in Settings → Privacy. E-mails, keys and your user folder are removed first.
- A dot in the chat header shows whether Hermes is answering (green), down (red) or missing its key (amber). While the chat is open Awuuu checks again on its own and says how to bring Hermes back; nothing is checked while the island is hidden.
- Frontend unit tests (vitest) for the live plan and the island's open/close logic; `npm test` runs them.

## [0.3.0] - 2026-10-03

- Agents hub with live plan and plan-limit chips, dashboard, settings, integrations sign-in, dog looks. See the git history for details.
