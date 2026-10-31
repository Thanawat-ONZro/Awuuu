import { currentLanguage } from "../i18n/i18n";
import { h } from "../views/dom";

/** Only anonymized tutorial exports belong in public/setup; never copy the source captures. */
export function setupImage(name: "calendar-mail" | "google-oauth" | "github-notion", en: string, th: string): HTMLElement {
  const thai = currentLanguage() === "th";
  const caption = thai ? th : en;
  const src = `./setup/${name}.png`;
  const preview = h("img", { src, alt: caption, loading: "lazy", decoding: "async" });
  const details = h("details", { class: "setup-image" },
    h("summary", { text: thai ? "ดูภาพประกอบขั้นตอน" : "See illustrated steps" }),
    h("figure", {}, h("figcaption", { text: caption }), preview,
      h("p", { class: "hint", text: thai ? "ภาพจากหน้าจอจริงที่ปิดข้อมูลส่วนตัวและปรับข้อความตัวอย่างแล้ว หน้าผู้ให้บริการอาจเปลี่ยนได้" : "Based on real screenshots with personal information removed and example labels substituted. Provider screens may change." })));
  const enlarge = h("button", { text: thai ? "ขยายภาพ" : "Enlarge image", onclick: () => {
    const close = h("button", { text: thai ? "ปิดภาพ" : "Close image" });
    const dialog = h("dialog", { class: "setup-image-dialog", "aria-label": caption }, close, h("img", { src, alt: caption })) as HTMLDialogElement;
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal();
  } });
  details.querySelector("figure")?.append(enlarge);
  return details;
}
