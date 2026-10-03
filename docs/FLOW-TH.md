# Awuuu: สรุป flow และ architecture (ภาษาไทย)

อ่านจากโค้ดที่ commit f16d712 (v0.3.0) ยังไม่ได้แก้โค้ดใดๆ

## ภาพรวม
Tauri 2: backend Rust (Win32, named pipe, HTTP) + frontend TypeScript ล้วน (Canvas 2D) อยู่ใน webview โปร่งใสที่ขอบบนจอ ไม่ขโมย focus
เป้าหมายผลิตภัณฑ์: เกาะ Hermes Agent ในเครื่อง (:8642) + เฝ้า agent CLI อื่น (Claude Code, AGY, Codex, OpenCode)

## 4 flow หลัก

1. **Hook → island** (`hook/src/main.rs` → `pipe.rs` → `island/hooks.ts`)
   Claude Code/AGY เรียก `awuuu-hook.exe` ทุก event → ส่ง JSON เข้า `\\.\pipe\awuuu-<sid>` → Rust emit event `hook` → `hooks.ts` แปลงเป็น `AgentTask` ใน `State`
   `PermissionRequest` เท่านั้นที่ค้างรอ: island ต้อง ack ภายใน 800 ms ว่าการ์ดขึ้นจอแล้ว ไม่งั้น decline คืนให้ terminal (ไม่บล็อก Claude Code) คลิก Allow/Deny → `approval_decision` → เขียนกลับ pipe
2. **Chat** (`views/chat.ts` → `chat_send` → `claude.rs::send`)
   เลือก backend ตามลำดับ: provider ที่ผู้ใช้เพิ่ม (OpenAI-compatible) → โมเดล `claude-*` (Anthropic API) → Hermes
   Hermes: ใช้ Runs API (`/v1/runs` + SSE events) ได้ session จริง มี memory/tools; ภาพหรือ Hermes รุ่นเก่า fallback เป็น chat completions
   ระหว่าง run ทุก event (tool, reasoning, approval) ถูกแปลงเป็น hook payload เดียวกับ Claude Code ทำให้ Hermes โผล่ใน Agents hub เหมือน agent อื่น
3. **Integrations** (`integrations.rs`, `extras.rs`, `oauth.rs`)
   poller เบื้องหลัง (GitHub, Stripe, Vercel, n8n, Resend, Notion, Cal.com + เมล/ปฏิทิน/RSS/uptime/อากาศ/Todoist) รัน เมื่อมี key ใน Credential Manager เท่านั้น → emit `integration` → pill/badge/เสียง; หน้า Today (`views/today.ts`) รวมเป็นรายการ "อะไรต้องการคุณ" เรียงตามความด่วน
4. **Island UI** (`island/fsm.ts`, `island.ts`, `mochi/engine.ts`)
   FSM 4 สถานะ: hidden → petit → home → coucou (ทักทายตอนเปิด); alert ที่รอคำตอบจะ pin ไว้; สุนัขวาดด้วย Canvas, เสียง WebAudio 28 ไฟล์ (หยุดเมื่อ idle)

## ส่วนรอบข้าง
- `history.rs`/`usage.rs`/`transcript.rs`: ประวัติสิ่งที่ agent ทำ, limit ของ Claude/Codex, อ่าน transcript
- `hooks.rs`: ติดตั้ง hook ลง settings.json อย่างปลอดภัย (backup, diff, ยืนยัน)
- `cli.rs` + `aw.cmd`: คำสั่ง `aw claude|hermes|...` เปิด agent โดยมี Awuuu เฝ้า
- หน้าต่าง dashboard (`src/app/`): Sessions, Stats, Integrations, Appearance, Privacy ฯลฯ
- `updater.rs`: เช็กอัปเดตจาก GitHub หลังผู้ใช้อนุญาต

## ข้อสังเกตจากโค้ด
- Persona ของน้องหมาบางมาก: `HERMES_SYSTEM` บอกแค่ "ตอบสั้น ไม่ใช้ markdown ตอบภาษาผู้ใช้" ความ friendly เกิดจากอนิเมชันกับเสียงเป็นหลัก ไม่ได้อยู่ในบทสนทนา
- Awuuu **ตั้งรับล้วน**: รอ hook/poll/ผู้ใช้พิมพ์ ยังไม่มีการเริ่มคุยเองจากสิ่งที่เห็น (เช่นประชุมใกล้ถึง, build พัง)
- Hermes ทำงานอยู่ฝั่งเซิร์ฟเวอร์ Hermes เอง Awuuu ไม่ได้ให้ "มือ" บนเครื่อง (เปิดแอป, อ่านไฟล์ที่เลือก, คลิปบอร์ด) นอกจากไฟล์ที่ลากมาวาง
- ข้อมูลจาก Today/integrations/history ไม่ถูกส่งให้ chat เป็นบริบท ผู้ช่วยจึงไม่รู้ว่าผู้ใช้กำลังทำอะไร
- Hermes ที่ไม่ได้รันตอนเปิดแอปจะรู้ก็ต่อเมื่อส่งข้อความ (probe เฉพาะตอนเปิดแชท)
- Frontend ไม่มี test (มี Rust unit test บางส่วน); `island.ts` 1.4k บรรทัด, `engine.ts` 1.5k บรรทัด

## ข้อเสนอแนวทางพัฒนา (เรียงตามคุ้มค่า)
1. **Persona + ความจำของน้องหมา**: system prompt ที่มีบุคลิกอบอุ่น (เรียกชื่อผู้ใช้, ภาษาไทยธรรมชาติ, อารมณ์ตรงกับ state ของสุนัข) แต่ยังให้ Hermes memory เป็นหลัก; ให้ตัวเลือกโทน (ขี้เล่น/เงียบ/มืออาชีพ)
2. **บริบทอัตโนมัติ**: แนบ "สิ่งที่ Awuuu รู้อยู่แล้ว" เข้า chat แบบสรุปสั้น (ประชุมถัดไป, PR รอรีวิว, agent ที่กำลังรัน/ล่าสุดพังอะไร, หน้าต่างที่โฟกัส) โดยผู้ใช้เปิด/ปิดได้ใน Privacy
3. **เชิงรุกแบบไม่กวน**: ให้ Hermes ช่วยสรุป/แนะนำตอนมี event สำคัญ (agent จบงาน/error, ประชุมอีก 10 นาที, เมลสำคัญ) เป็นข้อความสั้นหนึ่งบรรทัดจากน้องหมา มี quiet hours และ rate limit
4. **ปุ่มลัดงานจริง**: quick actions ใน island ("สรุปเมลวันนี้", "อธิบาย error ล่าสุดของ Claude", "ร่างตอบเมลนี้") ส่งเข้า Hermes พร้อมบริบท; คลิปบอร์ด/ข้อความที่เลือกเป็นอินพุต; ทุกการส่งออกต้องคลิกยืนยัน
5. **เสียงพูด**: พิมพ์ผ่านไมค์ (Windows speech หรือ Whisper ในเครื่อง) และฮอตคีย์ global เปิดแชทโดยไม่แย่ง focus
6. **ความทนทาน**: แสดงสถานะ Hermes (ออนไลน์/ออฟไลน์) บน island, retry/แจ้งเตือนเมื่อ gateway ล่ม, onboarding ที่ตรวจ key/URL ให้ครบก่อนเริ่ม
7. **คุณภาพโค้ด**: แตก `island.ts`/`engine.ts`, เพิ่ม test ฝั่ง TS สำหรับ fsm/hooks/plan (pure logic), เพิ่ม CI รัน `cargo test` + `tsc`

ข้อ 1-2 ทำได้เร็วและเห็นผลต่อ "friendly + ใช้งานได้จริง" ที่สุด
