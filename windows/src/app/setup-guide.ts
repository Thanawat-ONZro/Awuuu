import { Bridge } from "../core/bridge";
import { currentLanguage } from "../i18n/i18n";
import { dropdown } from "../ui/select";
import { h } from "../views/dom";
import { setupImage } from "./setup-images";

const local = (en: string, th: string) => currentLanguage() === "th" ? th : en;
type Step = [string, string, string?];
const guides: Record<string, Step[]> = {
  welcome: [["Start with Music, Notes or Shelf. No account is needed. Connect an agent only if you use one.", "เริ่มจากเพลง โน้ต หรือ Shelf ได้เลย ไม่ต้องสมัครบัญชี เชื่อม agent เฉพาะตัวที่คุณใช้งาน"]],
  modules: [["Use the switches to show features. Drag rows or use the arrows to reorder. Set up opens the required connection settings.", "ใช้สวิตช์เพื่อแสดงฟีเจอร์ ลากแถวหรือกดลูกศรเพื่อจัดลำดับ ปุ่มตั้งค่าจะพาไปยังการเชื่อมต่อที่ต้องใช้"], ["Translation: create a DeepL API key, save it below, choose DeepL, then enable Translation. Local LibreTranslate is an alternative for an existing local server.", "การแปล: สร้างคีย์ DeepL API บันทึกด้านล่าง เลือก DeepL แล้วเปิดการแปล ถ้ามีเซิร์ฟเวอร์ LibreTranslate อยู่แล้วสามารถใช้บริการในเครื่องได้", "https://www.deepl.com/your-account/keys"]],
  agents: [["Install and sign in to your coding agent first. Select Set up on its card, review the change, then confirm. Restart the agent and start a session to verify events appear.", "ติดตั้งและเข้าสู่ระบบ coding agent ก่อน กดตั้งค่าบนการ์ด ตรวจสิ่งที่จะเปลี่ยนแล้วจึงยืนยัน เปิด agent ใหม่และเริ่มงานเพื่อตรวจว่ามีเหตุการณ์ขึ้นในเกาะ"], ["Codex is marked experimental: live hook behavior still needs a real session check. Cursor asks for permissions in its own terminal.", "Codex ยังเป็นรุ่นทดลอง ต้องตรวจ hook กับเซสชันจริง ส่วน Cursor ขอสิทธิ์ใน terminal ของตัวเอง"]],
  chat: [["For an existing local model, start Ollama or LM Studio, then press Detect local. Choose a model and the provider used by Island chat.", "ถ้ามีโมเดลในเครื่อง ให้เปิด Ollama หรือ LM Studio แล้วกดตรวจหาในเครื่อง เลือกโมเดลและผู้ให้บริการสำหรับแชตในเกาะ", "https://ollama.com/download"], ["For a remote provider, get its API base URL, model name and API key from its dashboard. Add that provider, save the key and test the connection. Local Hermes requires its gateway to be running.", "ผู้ให้บริการออนไลน์: นำ API base URL ชื่อโมเดล และ API key จากแดชบอร์ดของผู้ให้บริการมาใส่ เพิ่มผู้ให้บริการ บันทึกคีย์ แล้วทดสอบการเชื่อมต่อ ส่วน Hermes ในเครื่องต้องเปิด gateway ไว้ก่อน"]],
  appearance: [["Choose a breed preset first, then adjust colors and details. The island preview updates immediately.", "เลือกสายพันธุ์สำเร็จรูปก่อน แล้วค่อยปรับสีและรายละเอียด ตัวเกาะจะแสดงผลทันที"]],
  island: [["Choose the display and edge, then adjust size. You can also move the island by dragging its grip or using Alt + drag.", "เลือกจอและขอบหน้าจอ แล้วปรับขนาด คุณย้ายเกาะด้วยการลากที่จับหรือกด Alt ค้างแล้วลากได้"]],
  general: [["Choose your language, startup behavior and sounds here. Lower the sound slider or disable sounds if you prefer silence.", "เลือกภาษา การเปิดพร้อมเครื่อง และเสียงที่หน้านี้ ลดแถบเสียงหรือปิดเสียงได้หากต้องการ"]],
  shortcuts: [["Click a shortcut field, press the key combination, then test it outside Settings. Choose a different combination if Windows or another app already uses it.", "คลิกช่องปุ่มลัดแล้วกดชุดปุ่มที่ต้องการ จากนั้นลองกดนอกหน้า Settings ถ้าชนกับ Windows หรือแอปอื่นให้เลือกชุดปุ่มใหม่"]],
  privacy: [["Choose whether to keep agent history and how many days to retain it. Read What leaves this PC before connecting an online provider.", "เลือกว่าจะเก็บประวัติ agent หรือไม่และเก็บกี่วัน อ่านหัวข้อข้อมูลที่ออกจากเครื่องก่อนเชื่อมบริการออนไลน์"]],
  about: [["Check for updates here. The optional aw command is a terminal shortcut; local island features do not require it.", "ตรวจอัปเดตที่หน้านี้ คำสั่ง aw เป็นทางลัดใน terminal ฟีเจอร์ในเกาะใช้งานได้โดยไม่ต้องติดตั้งคำสั่งนี้"]],
};

export function setupGuide(page: string): HTMLElement | null {
  const steps = guides[page];
  if (!steps) return null;
  return h("details", { class: "setup-guide" },
    h("summary", { text: local("How to set this up", "วิธีตั้งค่าและหาข้อมูลที่ต้องใช้") }),
    h("ol", {}, ...steps.map(([en, th, url]) => h("li", {}, local(en, th), url ? h("button", { class: "setup-guide-link", text: local("Open the source ↗", "เปิดหน้าที่ต้องใช้ ↗"), onclick: () => void Bridge.openUrl(url) }) : null))));
}

export function serviceGuide(name: string): HTMLElement | null {
  const sources: Record<string, [string, string]> = {
    Todoist: ["Settings → Integrations → Developer → API token", "https://app.todoist.com/app/settings/integrations/developer"],
    Stripe: ["Developers → API keys", "https://dashboard.stripe.com/apikeys"],
    Vercel: ["Account Settings → Tokens → Create", "https://vercel.com/account/settings/tokens"],
    n8n: ["Your n8n instance → Settings → n8n API → Create API key", "https://docs.n8n.io/api/authentication/"],
    Resend: ["Dashboard → API Keys → Create API key", "https://resend.com/api-keys"],
    Notion: ["Developer tools → Connections → New connection → API token → grant page access", "https://www.notion.so/profile/integrations"],
    "Cal.com": ["Settings → Developer → API Keys", "https://app.cal.com/settings/developer/api-keys"],
  };
  const source = sources[name];
  if (!source) return null;
  return h("details", { class: "setup-guide" }, h("summary", { text: local("Where to get this key", "หาคีย์จากที่ไหน") }),
    name === "Notion" ? setupImage("github-notion", "Panel 2: create or open your Notion connection and grant it access to the pages you want to read.", "ภาพที่ 2: สร้างหรือเปิด Connection ใน Notion แล้วอนุญาตให้เข้าถึงหน้าที่ต้องการอ่าน") : null,
    h("p", { text: source[0] }), h("p", { text: local("Create a key in this service, copy it into the field above, press Save, then Test. To disconnect, save an empty value.", "สร้างคีย์ในบริการนี้ คัดลอกมาใส่ช่องด้านบน กดบันทึกแล้วกดทดสอบ เมื่อต้องการยกเลิกให้ล้างช่องแล้วกดบันทึก") }),
    h("button", { text: local("Open provider ↗", "เปิดหน้าผู้ให้บริการ ↗"), onclick: () => void Bridge.openUrl(source[1]) }));
}

/** Keep each page's primary controls visible and put secondary settings behind a named disclosure. */
export function organizeSettingsSections(root: HTMLElement, page: string): void {
  if (!["agents", "chat", "appearance", "privacy", "about", "stats", "general"].includes(page)) return;
  const group = root.querySelector(":scope > .settings-groups");
  if (group) group.replaceWith(...Array.from(group.children));
  const sections = Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "SECTION");
  if (sections.length < 2) return;
  sections.forEach((section, index) => {
    const heading = section.querySelector(":scope > h2");
    if (!heading) return;
    const fold = h("details", { class: "settings-section" });
    fold.open = index === 0;
    const summary = h("summary", { text: heading.textContent ?? "" });
    heading.remove();
    section.before(fold);
    fold.append(summary, section);
  });
}

/** Upgrade legacy selects, including fields populated asynchronously, to the shared dropdown. */
export function enhanceSettingsSelects(root: HTMLElement): () => void {
  const mapped = new Map<HTMLSelectElement, ReturnType<typeof dropdown>>();
  const scan = () => {
    for (const [native, custom] of mapped) {
      if (!root.contains(native)) { custom.close(); mapped.delete(native); }
    }
    root.querySelectorAll("select").forEach((native) => {
      if (!mapped.has(native)) {
        const custom = dropdown({ options: () => Array.from(native.options).filter(o => !o.disabled).map(o => ({ value: o.value, label: o.text })), get: () => native.value, set: value => { native.value = value; native.dispatchEvent(new Event("change", { bubbles: true })); }, title: native.getAttribute("aria-label") ?? native.closest(".row")?.querySelector("label")?.textContent ?? undefined });
        native.hidden = true;
        native.after(custom);
        mapped.set(native, custom);
      }
      const custom = mapped.get(native)!;
      custom.querySelector("button")!.disabled = native.disabled;
      custom.refresh();
    });
  };
  const observer = new MutationObserver(() => { observer.disconnect(); scan(); observe(); });
  const observe = () => observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"] });
  scan(); observe();
  return () => { observer.disconnect(); mapped.forEach(custom => custom.close()); };
}
