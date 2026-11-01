# Awuuu sharing service (project operator only)

Installed Awuuu users do **not** install Cloudflare, Wrangler, Node.js or any other sharing tool. They click Share, then copy a link or show its QR. Recipients need only a browser. Local Shelf and clipboard history work without this service or the internet.

## Deploy once for the project

1. Use an operator Cloudflare account. Enable R2 and review its billing terms. Workers, Durable Objects and R2 can incur charges; request/storage limits below are not a dollar spending cap.
2. In this folder run `npx wrangler@4 login` and choose the correct project account.
3. Run `npx wrangler@4 r2 bucket create awuuu-share-files`.
4. Add a one-day lifecycle deletion rule to this bucket as a backup to the six-hour scheduled sweep. Expired shares are inaccessible immediately even before deletion.
5. Review `wrangler.jsonc`. Defaults: 25 MB per file, 24-hour links, 3 uploads per minute per IP and 100 uploads per UTC day globally. The budget is atomic in a SQLite Durable Object. Failed uploads can also consume the budget.
6. Run `npm run deploy`. Verify `https://<worker-host>/health` returns `service: awuuu-share` and `encrypted: true`.
7. Set `AWUUU_SHARE_URL=https://<worker-host>/` in the **release build environment**, then build the installer. This compiles the project service origin into the app. Do not ask users to enter it. For local development only, the same environment variable can point to `http://127.0.0.1:8787/`.
8. Before public rollout, test upload/download from two separate networks, QR on a phone, expiry, revoke, quota exhaustion and network failure. Monitor provider usage and configure account-level alerts/WAF controls for public traffic.

## Privacy and format

The app encrypts filename and content with a fresh AES-256-GCM key and nonce per share. The key is in the URL fragment, which is not part of HTTP requests. R2 stores ciphertext plus expiry and a hash of a separate revocation token. This is not zero metadata: the service sees request IPs, sizes and timing; Cloudflare may process infrastructure metadata.

Envelope: ASCII `AWU1` + 12-byte nonce + AES-GCM ciphertext/tag. Decrypted payload: 2-byte little-endian filename byte count, UTF-8 filename (maximum 240 bytes), then file bytes. AAD is UTF-8 `Awuuu share v1`. The recipient page has no external script, tracker or analytics. Anyone with the complete link can decrypt the file until expiry/revoke. A recipient who already saved it keeps their copy.

Share URLs and revocation tokens are kept in Windows Credential Manager. The local receipt index contains only IDs, filenames, expiry and service origin. No file is uploaded automatically.

## Verify locally

`npm test` uses Node's built-in test runner, no packages or cloud account required. `npm run dev` starts Wrangler locally and uses simulated R2/Durable Objects; that is **not** a publicly reachable universal sharing service.

Sources: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
