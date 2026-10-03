# Awuuu roadmap (แผนเวอร์ชัน)

ฐานปัจจุบัน: **v0.3.0** (commit `f16d712`). อ่านโค้ดจริงของ Awuuu และ repo อ้างอิงอีก 3 ตัว ณ 3 ต.ค. 2026
(coucou `ae38520` v0.1.3, dotpals `c97f7c6` v0.9.6, vorssaint-utils `aa6ddcb`).

ลำดับความสำคัญ (จาก Owen): **1) AI  2) เสถียรภาพ + UX/UI  3) Integration / หลาย tool  4) ฟีเจอร์เสริม**

วิธีทำงานทุก PR อยู่ใน [DEV-WORKFLOW.md](DEV-WORKFLOW.md)

## หลักการเลขเวอร์ชัน (semver ช่วงก่อน 1.0)
- `0.MINOR.0` = เวอร์ชันใหญ่หนึ่งธีม (ตารางด้านล่าง) ปล่อยเมื่อ PR ทั้งหมดของธีมนั้น merge และ build ผ่าน
- `0.x.PATCH` = แก้บั๊ก/ปรับเล็กหลังปล่อย ไม่มีฟีเจอร์ใหม่
- `1.0.0` = เมื่อติดตั้งได้โดยไม่โดน Defender เตือน, onboarding ครบ และไม่มีบั๊กร้ายแรงค้าง
- เลขเวอร์ชันถูก bump โดย `npm run release` บนเครื่อง Owen เท่านั้น (คีย์เซ็นอยู่ในเครื่อง) PR ฟีเจอร์ไม่แตะเลขเวอร์ชัน

## สิ่งที่ตรวจพบจากโค้ดจริง (ที่มาของแผน)
- **AI บางมาก**: `HERMES_SYSTEM` ใน `windows/src-tauri/src/claude.rs:30` สั่งแค่ "ตอบสั้น plain text ไม่มี markdown" ไม่มีบุคลิก ไม่มีบริบทว่าผู้ใช้ทำอะไรอยู่
- **แชทไม่มี markdown** (`windows/src/views/chat.ts`) ส่วน coucou 0.1.3 มีแล้ว (bold, list, code block + copy, เปิดเฉพาะลิงก์ http/https)
- **ไม่มีการตรวจอัตโนมัติ** และไม่มีเครดิต GitHub Actions ทั้งที่มี Rust unit test 92 ตัว จึงใช้ `windows/scripts/check-cloud.sh` ตรวจบน cloud แทน
- **TS ไม่มี test เลย** แต่มี pure logic ทดสอบง่าย (`island/plan.ts`, `island/fsm.ts`, การแปลง payload ใน `island/hooks.ts`)
- **Rust เป็นโค้ด Windows ล้วน** compile บน Linux ตรงๆ ไม่ได้ แต่ cross-compile ด้วย mingw แล้วรัน test ด้วย wine ได้ (ลองแล้ว: app 75/75, hook 15/16 โดยตัวที่ข้ามใช้คำสั่ง `waitfor` ที่ wine ไม่มี)
- ไฟล์ใหญ่ที่แก้ยาก: `island/island.ts` 1.4k บรรทัด, `mochi/engine.ts` 1.5k บรรทัด, `hooks.rs` 1.36k บรรทัด
- dotpals มีสิ่งที่ Awuuu ยังขาด: story engine (สรุปงานของ agent เป็นภาษาคน), ตรวจผลเทสต์จริง, ใช้ `git status` เป็นความจริง, guard สอง agent แก้ไฟล์เดียวกัน, `doctor`, ชุดเคสจริงสำหรับวัดความแม่น (MIT, ดัดแปลงได้โดยคง notice)
- vorssaint-utils (GPL-3.0, macOS) ให้แนวคิด Command Bar, Clipboard, Scratchpad, "Watch" (เฝ้าส่วนหนึ่งของจอแล้วเตือน) **ยืมแนวคิดเท่านั้น ห้ามคัดลอกโค้ด**

---

## v0.4.0 — "หมาที่คุยรู้เรื่อง" (AI + ฐานรากการตรวจ)
เป้าหมาย: คุยกับ Awuuu แล้วรู้สึกเป็นเพื่อนที่รู้ว่าเรากำลังทำอะไร และทุก PR ต่อจากนี้มีการตรวจอัตโนมัติคุม

| PR | งาน | เกณฑ์ผ่าน |
|---|---|---|
| 4.1 | **ฐานการตรวจ**: เพิ่ม vitest + test แรกของ `plan.ts`/`fsm.ts` เข้า `check-cloud.sh`, PR template, `CHANGELOG.md` | `check-cloud.sh` ผ่าน |
| 4.2 | **Persona น้องหมา**: system prompt ใหม่ที่อบอุ่น เรียกชื่อผู้ใช้ ภาษาไทยธรรมชาติ, ตัวเลือกโทน (ขี้เล่น / เงียบ / มืออาชีพ) ใน Settings → Chat; Hermes memory ยังเป็นหลัก | unit test ประกอบ prompt ตามโทน (Rust) |
| 4.3 | **Markdown ในแชท**: renderer เล็กเขียนเอง (ไม่มี `innerHTML` จากข้อความดิบ), code block + ปุ่ม copy, เปิดเฉพาะ http/https; prompt อนุญาต markdown | vitest ครอบ XSS/ลิงก์ไม่ปลอดภัย |
| 4.4 | **บริบทอัตโนมัติ (opt-in)**: แนบสรุปสั้น "สิ่งที่ Awuuu รู้" (ประชุมถัดไป, PR รอรีวิว, agent ที่รัน/พังล่าสุด) เข้าแชท สวิตช์เปิดปิดใน Privacy, ตัดข้อมูลลับก่อนส่ง | vitest ของตัวสร้างสรุป + redaction |
| 4.5 | **สถานะ Hermes บน island**: probe เบื้องหลังแบบ backoff (หยุดเมื่อซ่อน = 0% CPU), จุดสีออนไลน์/ออฟไลน์, ข้อความแนะนำเมื่อ gateway ล่ม | Rust test ของ backoff, Owen ตรวจ CPU idle บนเครื่อง |

## v0.5.0 — "รู้ว่า agent ทำอะไรจริง" (หัวใจ AI)
แนวคิดจาก dotpals (MIT) เขียนใหม่เป็น TS pure function

| PR | งาน |
|---|---|
| 5.1 | **Story engine** (ต่อยอดจาก `app/recap.ts` ที่มีอยู่): รวม hook event เป็น "บท" ต่อคำขอ ("แก้ 5 ไฟล์ +42 −7 · เทสต์พัง 2 รอบแล้วผ่าน · commit แล้ว") แบบ Simple/Detailed |
| 5.2 | **ตรวจผลเทสต์จริง**: parse jest/vitest/pytest/cargo/go, "0 tests" = ไม่ชัด, เตือน "แก้ไฟล์หลังเทสต์ล่าสุด" |
| 5.3 | **Git เป็นความจริง**: snapshot `git status` ต้น/ท้ายคำขอ (Rust command) จับไฟล์ที่เปลี่ยนนอก hook |
| 5.4 | แสดง story บน island, หน้า Sessions และ recap; ชุดเคสจริง (`test/cases/*.json`) วัดความแม่น |
| 5.5 | **ตัวตัดสินด้วย Hermes** สำหรับผลคลุมเครือ: ทำงานเมื่อกดปุ่ม "Ask Hermes" เท่านั้น, redaction, timeout 8 วิ |

## v0.6.0 — "นิ่งและลื่น" (เสถียรภาพ + UX)
| PR | งาน |
|---|---|
| 6.1 | **Guard สอง agent แก้ไฟล์เดียวกัน** (เตือนก่อนผ่าน PreToolUse ของ Claude, เตือนทีหลังสำหรับ agent อื่น) |
| 6.2 | **Hotkey**: Ctrl+Alt+Y/N อนุมัติเฉพาะตอนมีการ์ด, ฮอตคีย์ global เปิดแชทโดยไม่แย่ง focus |
| 6.3 | **Fallback จาก transcript** (`~/.claude/projects`, `~/.codex/sessions`) เมื่อไม่มี hook |
| 6.4 | **`aw doctor`**: ตรวจ pipe, hook ติดตั้งไหม, Hermes ตอบไหม, key ครบไหม แล้วบอกวิธีแก้ |
| 6.5 | ตรวจความปลอดภัยตาม coucou (ลิงก์, ขนาด/เวลา pipe, log ไม่เก็บคำสั่งเต็ม) + แตก `island.ts`/`engine.ts` เป็นโมดูลย่อยพร้อม test |

## v0.7.0 — "ต่อได้ทุก tool" (Integration)
| PR | งาน |
|---|---|
| 7.1 | **Adapter registry**: agent ใหม่ = 1 ไฟล์ (id, detect, install, describeTool) แทนกระจายใน `hooks.rs`/`hooks.ts` |
| 7.2 | เพิ่ม **Cursor, Gemini CLI, GitHub Copilot CLI** + payload ทั่วไป (`awuuu_agent`) ให้ agent ใดๆ ส่งเข้ามาได้ |
| 7.3 | หน้า Agents: Connect / Disconnect / Send test event / event ล่าสุดเมื่อไร (backup + diff + ยืนยันตามกฎ settings.json) |
| 7.4 | **Context กลับเข้า agent**: ตอน SessionStart ฉีดสรุปสั้น ("เมื่อกี้ Codex แก้ billing.ts") |
| 7.5 | **Handoff**: "ทำต่อใน ▾" เขียนโน้ตส่งต่อแล้วเปิด agent อื่นผ่าน `aw` |

## v0.8.0 — "ช่วยชีวิตประจำวัน" (ฟีเจอร์เสริม)
| PR | งาน |
|---|---|
| 8.1 | **เชิงรุกแบบไม่กวน**: ข้อความหนึ่งบรรทัดเมื่อ agent จบ/พัง, ประชุมอีก 10 นาที; quiet hours + rate limit |
| 8.2 | **Quick actions**: "สรุปเมลวันนี้", "อธิบาย error ล่าสุด", "ร่างตอบ" จาก island; ส่งออกต้องคลิกยืนยัน |
| 8.3 | **Command Bar** (แนวคิด vorssaint เขียนเอง): ค้น session/ประวัติ/การกระทำ/คำนวณ |
| 8.4 | Scratchpad + clipboard ส่งเข้าแชท, ตัวจับเวลาโฟกัส/พักสายตาที่น้องหมาเตือน |
| 8.5 | หน้า UI ภาษาไทย/อังกฤษ |

## v1.0.0 — พร้อมแจก
Code signing (กัน Defender false positive ที่ coucou เจอ), onboarding ตรวจ key/URL ครบ, เอกสารผู้ใช้, แก้บั๊กค้างทั้งหมด

---

## งบ cloud (ประเมินคร่าวๆ)
- เอกสารแผนนี้: ประมาณ $2–4
- PR ขนาดกลางหนึ่งตัว (อ่านโค้ด, เขียน, test, รัน check-cloud.sh): ประมาณ $2–5
- v0.4.0 ทั้งชุด (5 PR): ประมาณ **$12–22**
- ทั้ง roadmap ถึง v0.8 (~25 PR) เกิน $50 แน่นอน ดังนั้นทำทีละเวอร์ชันแล้วทบทวนงบก่อนเริ่มเวอร์ชันถัดไป
- ตัวเลขนี้เป็นการประเมิน ไม่ใช่การวัดจริง
- ไม่ใช้นาที GitHub Actions เลย การตรวจทั้งหมดรันใน cloud session (ติดตั้ง mingw + wine ครั้งแรกของแต่ละ session ใช้เวลาไม่กี่นาที)
