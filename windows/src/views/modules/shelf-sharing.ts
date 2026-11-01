import { Bridge, type ShelfFile, type ShareReceipt, type ShareServiceStatus } from "../../core/bridge";
import { h, clear } from "../dom";
import { t } from "../../i18n/i18n";

export function createShelfSharing(onAvailability: () => void) {
  let status: ShareServiceStatus | null = null;
  let receipts: ShareReceipt[] = [];
  let busy = false, disposed = false;
  const badge = h("span", { class: "shelf-share-status", text: t("Checking sharing…"), role: "status" });
  const panel = h("div", { class: "shelf-share-panel", hidden: true });
  const history = h("details", { class: "shelf-share-history" }, h("summary", { text: t("Active share links") }));
  const historyList = h("div", { class: "shelf-share-links" });
  history.append(historyList); history.hidden = true;
  const el = h("div", { class: "shelf-sharing" }, badge, panel, history);
  const canShare = (size: number) => navigator.onLine && Boolean(status?.available) && size <= (status?.maxBytes ?? 0) && !busy;
  const expires = (receipt: ShareReceipt) => t("Expires {time}", { time: new Date(receipt.expiresAtMs).toLocaleString() });

  function renderHistory() {
    clear(historyList);
    receipts = receipts.filter(r => r.expiresAtMs > Date.now()); history.hidden = receipts.length === 0;
    for (const receipt of receipts) {
      historyList.append(h("div", { class: "shelf-share-link" },
        h("span", {}, h("strong", { text: receipt.name }), h("small", { text: expires(receipt) })),
        h("button", { text: t("Link / QR"), onclick: () => showReceipt(receipt) })));
    }
  }
  function showReceipt(receipt: ShareReceipt) {
    clear(panel); panel.hidden = false;
    const message = h("p", { role: "status", "aria-live": "polite" });
    const revoke = h("button", { text: t("Revoke link"), disabled: !navigator.onLine, onclick: async () => {
      revoke.disabled = true;
      try { await Bridge.shelfShareRevoke(receipt.id); panel.hidden = true; await refresh(); }
      catch (error) { message.textContent = t(String(error).replace(/^Error:\s*/, "")); revoke.disabled = false; }
    } });
    panel.append(h("strong", { text: receipt.name }),
      h("img", { class: "shelf-share-qr", src: receipt.qr, alt: t("Scan to download this file") }),
      h("p", { text: expires(receipt) }),
      h("p", { text: t("Anyone with the complete link can download. Revoking stops future downloads; saved copies remain.") }),
      h("div", { class: "shelf-share-actions" },
        h("button", { text: t("Copy link"), onclick: async () => {
          try { await Bridge.clipboardWriteText(receipt.url); message.textContent = t("Link copied."); } catch (error) { message.textContent = t(String(error).replace(/^Error:\s*/, "")); }
        } }), revoke, h("button", { text: t("Close"), onclick: () => { panel.hidden = true; } })), message);
  }
  function open(input: ShelfFile | ShelfFile[]) {
    const files = Array.isArray(input) ? input : [input];
    if (!files.length || files.some(file => !canShare(file.size))) return;
    const pending = [...files];
    const completed: ShareReceipt[] = [];
    clear(panel); panel.hidden = false;
    const message = h("p", { role: "status", "aria-live": "polite" });
    const upload = h("button", { text: t("Upload encrypted file"), onclick: async () => {
      if (busy) return;
      busy = true; upload.disabled = true; cancel.disabled = true; onAvailability();
      message.textContent = t("Encrypting and uploading… This can take up to 90 seconds.");
      try {
        while (pending.length) {
          const receipt = await Bridge.shelfShareCreate(pending[0].path);
          pending.shift(); completed.push(receipt); receipts.unshift(receipt);
          if (disposed) return;
          renderHistory();
        }
        if (completed.length === 1) showReceipt(completed[0]);
        else {
          clear(panel);
          panel.append(h("strong", { text: t("{n} share links ready", { n: completed.length }) }),
            h("button", { text: t("Copy all links"), onclick: async () => {
              try { await Bridge.clipboardWriteText(completed.map(receipt => `${receipt.name}\n${receipt.url}`).join("\n\n")); }
              catch (error) { message.textContent = t(String(error).replace(/^Error:\s*/, "")); }
            } }));
          for (const receipt of completed) panel.append(h("button", { text: receipt.name, onclick: () => showReceipt(receipt) }));
          panel.append(h("button", { text: t("Close"), onclick: () => { panel.hidden = true; } }), message);
        }
      }
      catch (error) { if (!disposed) { message.textContent = t(String(error).replace(/^Error:\s*/, "")); upload.disabled = false; cancel.disabled = false; } }
      finally { busy = false; if (!disposed) onAvailability(); }
    } });
    const cancel = h("button", { text: t("Cancel"), onclick: () => { panel.hidden = true; } });
    panel.append(h("strong", { text: files.length === 1 ? files[0].name : t("Share {n} files", { n: files.length }) }),
      ...(files.length > 1 ? [h("p", { text: t("Each file gets its own link. Completed uploads remain in Active share links if an upload fails.") })] : []),
      h("p", { text: t("The file is encrypted on this PC before upload. The link expires after 24 hours. Maximum 25 MB. Local Shelf files are kept separately.") }),
      h("div", { class: "shelf-share-actions" }, upload, cancel), message);
  }
  async function refresh() {
    if (disposed) return;
    const service = navigator.onLine ? Bridge.shelfShareStatus() : Promise.resolve(null);
    const [health, saved] = await Promise.all([service, Bridge.shelfShareList().catch(() => [])]);
    if (disposed) return;
    status = health; receipts = saved;
    badge.textContent = !navigator.onLine ? t("Internet required for sharing") : !status?.configured ? t("Sharing service is not available in this build") : status.available ? t("Share encrypted links · 24 hours · up to 25 MB") : t("Sharing service is unavailable. Local files still work.");
    renderHistory(); onAvailability();
  }
  const networkChanged = () => { void refresh(); };
  window.addEventListener("online", networkChanged); window.addEventListener("offline", networkChanged);
  return { el, canShare, open, refresh, dispose() { disposed = true; window.removeEventListener("online",networkChanged); window.removeEventListener("offline",networkChanged); } };
}
