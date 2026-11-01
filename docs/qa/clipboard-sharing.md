# Clipboard and Shelf sharing acceptance checks

## Implemented and verified in code

- Automatic, event-driven Windows clipboard history inside Shelf; pause in Privacy & history. Text/image support, filters, search, copy, individual removal and clearing.
- Session-local storage: maximum 50 entries / 20 MB total, 64 KB per text / 4 MB per stored PNG; expires after 24 hours and clears on app exit.
- Clipboard image decode, thumbnail generation and copy encoding run outside the clipboard lock/UI thread; sensitive exclusion formats are respected.
- Encrypted Shelf link/QR client, local receipts in Credential Manager, expiry and remote revoke.
- Cloudflare Worker/R2 backend source with atomic global upload budget, per-IP throttling, 25 MB payload limit and scheduled expiry deletion.
- Separate offline and endpoint-not-deployed states. No end-user Cloudflare setup.
- Actual connection report: saved success is distinguished from an actual successful read request. Weather/Todoist/Uptime/Feeds tests no longer return an unconditional success after swallowed errors.

## Live connection observations (1 November 2026)

- Calendar, Mail, GitHub and Notion: real read requests succeeded using current local configuration. No secrets or account data are included here.
- Weather: the final native test reports that the configured city was not found. Choose a recognized city name and test again. A separate HTTPS check of the forecast host also returned 503; that does not establish the cause of the configured-city failure. Do not treat either result as a successful forecast refresh.
- Todoist, News, Uptime, Stripe, Vercel, Resend, n8n and Cal.com: not configured; no live request sent.
- Codex, AGY and Hermes: existing activity history contains actual events, including recent events in this session. Protocol unit tests also pass.
- Claude: installed and hooks connected, but a fresh Claude session was not launched for this check.
- OpenCode: installed, plugin/hook is not connected. Use Agents → Set up and review the change before installing.
- Cursor: not installed.
- Receiving activity does not prove every approval/deny interaction; test those interactively with a harmless request.
- The Windows clipboard listener registered successfully on the live app. Recording now defaults to on; explicitly saved pauses are respected.

## Automated verification

- Frontend: 339 tests across 52 files passed; TypeScript and production frontend build passed.
- Native clipboard: four tests passed (deduplication/expiry, image memory budget, malformed bitmap handling and pixel-preserving DIB conversion).
- Native sharing: encryption roundtrip and ID validation passed. Rust-to-real-Wrangler-local integration passed: upload, download/decrypt, QR creation, failed unauthorized revoke, successful revoke, then 404.
- Hook relay: 18 protocol tests passed. Sanitized connection-error test passed.
- Backend: four Node tests passed, including executing the actual browser download script against an encrypted envelope, expiry/cleanup and upload budgets.
- No personal clipboard content or user files were uploaded for testing. The local Workers test service was stopped afterward; Awuuu dev remains running.

## User acceptance steps

1. Open Shelf → Clipboard. Copy Thai/English multiline text, a URL, a color, code and a screenshot in other apps. Check search/filters in the top row and paste a historical text/image into another app. Both tabs scroll horizontally, without vertical page scrolling.
2. Pause recording in Privacy & history, copy another item and verify it is not added. Remove one item and clear the list. Restart Awuuu and verify session history is empty and the explicit pause remains.
3. Disable internet. Local Files/Clipboard should work; upload should show Internet required. A build without a configured backend should instead say that sharing is unavailable in this build.
4. After the operator deploys the service: drop a small file, Share → Upload encrypted file. Scan the QR on a phone using a different network and compare the downloaded bytes/file. Close Awuuu after upload; the receiver should still be able to download.
5. Reopen Awuuu, open Active share links and revoke. A fresh recipient download must fail. An expired link must also fail. Try a file over 25 MB and a dropped non-Shelf path; both must be rejected before upload.
6. About & aw → Test saved connections should show the actual successes/failures and skip unconfigured services. Never paste tokens or private iCal links into a bug report.
7. Start each coding agent you use. Verify a harmless tool event appears, then test an approval and deny where supported. OpenCode still needs its reviewed setup; Codex may require trusting hooks with `/hooks`.

## External release gate

Universal sharing is not publicly available until an operator Cloudflare account is connected, the service is deployed, and its HTTPS origin is supplied to the release build. Local/mocked tests do not satisfy the two-network acceptance check. See [operator guide](../../services/share/README.md).

## Live clipboard regression verification
The old clipboardRecording=false preference was reproduced on this PC. Automatic capture now uses clipboardPaused to distinguish an intentional pause from the retired opt-in default. The live Windows test (windows/scripts/check-clipboard-live.ps1) copied synthetic text and a bitmap from an external process; both reached the running app's history. The original clipboard was restored from an in-memory backup. Reports contain only ready/enabled/count metadata. A separate UI regression verifies that the history-changed event renders a new entry.

## Shelf selection and layout regression
- Select all, share selected paths and delete only selected paths: frontend regression passed; selection preserves tile DOM.
- Repeated Put on Shelf clicks during copying: regression passed; original filename is passed to backend.
- Native duplicate test: identical content reused, original Thai filename preserved, same name with different bytes kept separately.
- Selected preview uses an internal border (no external outline or scale) after user screenshot showed clipping. Check visually at minimum landscape width and side dock.
- Batch sharing creates separate links per file; uploaded successes remain in Active share links after partial failure. A live deployed service is still required.

## Native drag-out and file icon fixes
- Drag a file, or a selected group, to a Desktop/Explorer folder. Destination should receive copies; Shelf originals should remain. Try Esc to cancel and a chat upload area that accepts file drops. Native OLE replaces the former text/path-only HTML payload.
- Self-drop is ignored while dragging out, preventing a second ingestion.
- Native tests verify Shelf-only drag path validation and canonical-path executable icons. The icon test failed before normalizing verbatim paths and passed afterward.
- A frontend regression verifies selected paths reach native drag, drag state resets, and failed icons retry without replacing tiles. Actual Explorer/chat drop acceptance still needs an interactive check.
- Link/QR sharing remains unavailable until the project service is deployed; it is separate from local file dragging.
