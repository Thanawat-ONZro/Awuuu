import { Bridge } from "../core/bridge";
import { currentLanguage } from "../i18n/i18n";
import { h } from "../views/dom";

const costs: Record<string, [string, string, string]> = {
  Translation: ["DeepL and Google Cloud Translation have provider-specific plans, quotas and possible usage charges. A running local LibreTranslate server uses your own hardware or hosting. Check pricing before saving a cloud key.", "DeepL และ Google Cloud Translation มีแพ็กเกจ โควต้า และค่าใช้จ่ายตามการใช้งาน ส่วน LibreTranslate ในเครื่องใช้ทรัพยากรเครื่องหรือโฮสติ้งของคุณ ตรวจราคาก่อนบันทึกคีย์ออนไลน์", "https://cloud.google.com/translate/pricing"],
  "Cloud chat": ["Cloud models consume API usage and may charge your provider account. A chat subscription may not include API credits. Local models use your hardware; a local Hermes gateway can still call a paid cloud model.", "โมเดลออนไลน์ใช้โควต้า API และอาจคิดเงินกับบัญชีผู้ให้บริการ แพ็กเกจแชตอาจไม่รวมเครดิต API โมเดลในเครื่องใช้ทรัพยากรเครื่อง ส่วน Hermes gateway ในเครื่องยังอาจเรียกโมเดลออนไลน์ที่คิดเงินได้", "https://www.anthropic.com/pricing"],
  Google: ["Standard Gmail and Calendar API use has no additional charge, but requests consume your Google Cloud quota. Calendar's published daily billing threshold is 1,000,000 requests per project; Google has announced changes to excess-usage billing. Other Cloud products can have separate charges. Check the project's Quotas and Billing pages before enabling paid services. Checked 1 Nov 2026.", "การใช้ Gmail และ Calendar API แบบมาตรฐานไม่มีค่าบริการเพิ่ม แต่คำขอนับในโควต้า Google Cloud เอกสาร Calendar ระบุเกณฑ์การคิดเงินรายวันที่ 1,000,000 คำขอต่อโปรเจกต์ และ Google ประกาศแผนปรับการคิดเงินเมื่อใช้เกินเกณฑ์ บริการ Cloud ตัวอื่นอาจมีค่าใช้จ่ายแยก ตรวจหน้า Quotas และ Billing ก่อนเปิดบริการที่มีค่าใช้จ่าย ตรวจข้อมูล 1 พ.ย. 2026", "https://developers.google.com/workspace/calendar/api/guides/quota"],
  Microsoft: ["This connection reads mail and calendar through Microsoft Graph. Your Microsoft account or organization plan and API limits apply; this setup does not buy a subscription.", "การเชื่อมต่อนี้อ่านเมลและปฏิทินผ่าน Microsoft Graph ใช้ข้อจำกัดของบัญชีหรือแพ็กเกจองค์กร ขั้นตอนนี้ไม่ได้ซื้อแพ็กเกจเพิ่ม", "https://learn.microsoft.com/en-us/graph/throttling"],
  GitHub: ["These requests count toward GitHub API rate limits shared with your other apps. Connecting a token does not purchase a GitHub plan or run Actions.", "คำขอนับในโควต้า GitHub API ที่ใช้ร่วมกับแอปอื่น การเชื่อม token ไม่ได้ซื้อแพ็กเกจ GitHub หรือสั่งรัน Actions", "https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api"],
  Calendar: ["A private iCal feed does not use your Google Cloud API project. Your calendar provider and internet service still apply.", "ลิงก์ iCal ส่วนตัวไม่ใช้โปรเจกต์ Google Cloud API ของคุณ ยังคงใช้บริการปฏิทินและอินเทอร์เน็ตตามปกติ", "https://support.google.com/calendar/answer/37648"],
  Weather: ["Uses Open-Meteo's public API, subject to its usage terms and limits. Commercial use may need a paid API plan.", "ใช้ API สาธารณะของ Open-Meteo ตามเงื่อนไขและโควต้า การใช้งานเชิงพาณิชย์อาจต้องใช้แพ็กเกจ API แบบเสียเงิน", "https://open-meteo.com/en/pricing"],
  Notion: ["Reads your connected pages through the Notion API. It does not invoke Notion AI. Workspace plans and API limits still apply.", "อ่านหน้าที่อนุญาตผ่าน Notion API โดยไม่ได้เรียก Notion AI ยังคงใช้แพ็กเกจและโควต้าของ workspace", "https://www.notion.com/pricing"],
  Stripe: ["Reads balance and payment data. Your existing Stripe payment fees and account terms still apply.", "อ่านยอดเงินและข้อมูลการชำระเงิน ยังคงมีค่าธรรมเนียมการชำระเงินและเงื่อนไขบัญชี Stripe เดิม", "https://stripe.com/pricing"],
  Vercel: ["Reads deployments. Your existing Vercel plan and resource usage may be billed by Vercel.", "อ่านข้อมูล deployment แพ็กเกจและการใช้ทรัพยากรเดิมของ Vercel อาจมีค่าใช้จ่าย", "https://vercel.com/pricing"],
  n8n: ["Reads workflow runs. n8n Cloud subscriptions or the server hosting your own instance may cost money.", "อ่านประวัติ workflow การสมัคร n8n Cloud หรือเซิร์ฟเวอร์ที่ติดตั้งเองอาจมีค่าใช้จ่าย", "https://n8n.io/pricing/"],
  Resend: ["Reads email activity. Your Resend plan, sending quotas and overage terms still apply.", "อ่านกิจกรรมอีเมล แพ็กเกจ โควต้าส่งอีเมล และค่าใช้เกินโควต้าของ Resend ยังคงมีผล", "https://resend.com/pricing"],
  Todoist: ["Reads tasks from your account. Available features and limits depend on your Todoist plan.", "อ่านงานจากบัญชี ฟีเจอร์และข้อจำกัดขึ้นกับแพ็กเกจ Todoist ที่ใช้", "https://todoist.com/pricing"],
  "Cal.com": ["Reads bookings. API access and available features depend on your Cal.com plan.", "อ่านรายการนัดหมาย สิทธิ์ใช้ API และฟีเจอร์ขึ้นกับแพ็กเกจ Cal.com", "https://cal.com/pricing"],
};

export function serviceCost(name: string): HTMLElement | null {
  const cost = costs[name];
  if (!cost) return null;
  const thai = currentLanguage() === "th";
  return h("details", { class: "int-cost" },
    h("summary", { text: thai ? "ค่าใช้จ่ายและโควต้า" : "Cost & usage limits" }),
    h("p", { text: cost[thai ? 1 : 0] }),
    h("button", { text: thai ? "ตรวจเงื่อนไขผู้ให้บริการ ↗" : "Check provider terms ↗", onclick: () => void Bridge.openUrl(cost[2]) }));
}
