# เทียบ Awuuu กับ 3 โปรเจกต์อ้างอิง และแผนพัฒนา

อ่านจาก README/CHANGELOG/ARCHITECTURE และซอร์สบางไฟล์ของแต่ละ repo (ผ่าน GitHub ณ 3 ต.ค. 2026) ยังไม่ได้แก้โค้ด Awuuu
ลำดับความสำคัญตามที่ Owen ระบุ: **1) AI  2) เสถียรภาพ + UX/UI  3) Integration/หลาย tool  4) feature เสริม**

## โปรเจกต์ทั้งสามคืออะไร
| โปรเจกต์ | แนวคิด | License | ใช้กับเราได้แค่ไหน |
|---|---|---|---|
| **coucou** (Louis-CFM) | ต้นทางของ Awuuu: Mochi ใน notch, hook, chat, integrations | MIT | ตามอัปเดตได้เลย (Awuuu fork มา) |
| **dotpals** (Rikinshah787) | "เห็นว่า agent ทำอะไรจริงๆ": สรุปเป็นภาษาคน, ตรวจว่าเทสต์ผ่านจริงไหม, กันสอง agent แก้ไฟล์เดียวกัน, handoff | MIT (ส่วน checker/redact มาจาก claude-referee MIT, ต้องคง notice) | **ให้ไอเดียด้าน AI มากที่สุด** นำ logic มาดัดแปลงได้ (JS → TS) |
| **vorssaint-utils** (vorssaint) | เครื่องมือเมนูบาร์ macOS รวมเป็นหนึ่ง: Command Bar, Quick panel, Dynamic Island, Scratchpad, Clipboard, catalog ฟีเจอร์ติดตั้ง/ถอนได้ | **GPL-3.0** | **ยืมแนวคิดเท่านั้น ห้ามคัดลอกโค้ด** (จะทำให้ Awuuu ติด GPL) และเป็น macOS ล้วน |

## Awuuu มีอะไรแล้ว (ไม่ต้องทำซ้ำ)
hook หลาย agent (Claude, AGY, Codex, OpenCode, Hermes), อนุมัติ/ตอบคำถามจาก island, plan สด, usage limit ของ Claude/Codex, history + recap + stats, Today, provider หลายเจ้า + ตรวจ local provider, OAuth เมล/ปฏิทิน, `aw` CLI, updater

## ช่องว่างและข้อเสนอ

### ลำดับ 1: AI (สำคัญสุด)
จุดที่ Awuuu ยังอ่อนที่สุด: เป็นแค่ "หน้าต่างแชท + แดชบอร์ด" ยังไม่มีสมองช่วยตีความงานของ agent

1. **"เรื่องเล่า" แทน log (จาก dotpals story engine)**: รวม event เป็น request → บทสั้นๆ ("แก้ 5 ไฟล์ +42 −7 · เทสต์พังสองครั้งแล้วผ่าน · commit แล้ว") และสรุปประโยคเดียวแบบ Simple/Detailed ใช้ได้ทั้งบน island, Sessions และ recap; เป็น pure function ทดสอบง่าย
2. **ตรวจว่า "เทสต์ผ่านจริงไหม" และ "หลังแก้ไฟล์ล่าสุดยังไม่ได้เทสต์"**: parse ผลของ jest/vitest/pytest/cargo/go ฯลฯ, ถือ "0 tests" ว่าไม่ชัดเจน, ผูก retry ("แก้สำเร็จรอบที่ 2") ปัจจุบัน Awuuu บอกแค่ ✓/✕ ของคำสั่ง
3. **ใช้ git เป็นความจริง (ground.js)**: เทียบ snapshot ของ `git status` ตอนเริ่ม/จบ request เพื่อรู้ว่าไฟล์ไหนเปลี่ยนจริง แม้เปลี่ยนด้วย `sed -i` หรือ formatter ที่ hook มองไม่เห็น
4. **ให้ Hermes ช่วยตัดสินเฉพาะกรณีคลุมเครือ**: ถ้ากฎเดิมตัดสินผลเทสต์ไม่ได้ ส่งท้ายเอาต์พุตที่ผ่าน redaction (ลบ key/token/อีเมล/IP/home path) ให้ Hermes หรือโมเดลที่ผู้ใช้เลือก ตอบ ผ่าน/ไม่ผ่าน; ต้อง fail-open และจำกัดเวลา (dotpals ใช้ 5 วิ), ปิดเป็นค่าเริ่มต้น
5. **Persona + บริบทอัตโนมัติ + เชิงรุก** (จากรอบก่อน): ให้ Hermes รู้ว่าผู้ใช้กำลังทำอะไรจากข้อมูลที่ Awuuu มีอยู่แล้ว (ตารางงาน, PR, agent ที่พัง) และพูดขึ้นเองสั้นๆ ตอนเหตุการณ์สำคัญ
6. **ตอบ markdown ในแชท**: coucou 0.1.3 มี bold/list/code block พร้อมปุ่ม copy ส่วน Awuuu สั่งให้ตอบแบบ plain text จึงอ่านคำตอบยาวหรือโค้ดไม่สะดวก
7. **Handoff ระหว่าง agent**: "Continue in ▾" เขียนโน้ตว่าถูกขออะไร/ทำอะไรแล้ว/เทสต์เป็นอย่างไร/เหลืออะไร แล้วเปิด terminal ใหม่รัน agent อื่นใน project เดียวกัน (Awuuu มี `aw` และข้อมูลครบแล้ว เหลือแค่ประกอบ)

### ลำดับ 2: เสถียรภาพ + UX/UI
1. **กันสอง agent แก้ไฟล์เดียวกัน** (guard.js): เตือนก่อนแก้สำหรับ Claude Code (ผ่าน PreToolUse) และเตือนทีหลังสำหรับ agent อื่น; ปัญหานี้เจอจริงเมื่อรันหลาย agent
2. **ปุ่มลัดอนุมัติ** (dotpals: Ctrl+Alt+Y/N เฉพาะตอนมีการ์ด) + global hotkey เปิด/ซ่อนสุนัข
3. **เปลี่ยนจาก "เปิดไฟล์สถานะ" เป็น fallback ที่ทนทาน**: อ่าน transcript/session log ของ Claude (`~/.claude/projects`) และ Codex (`~/.codex/sessions`) เมื่อไม่มี hook เพื่อให้ session ที่เริ่มก่อนติดตั้ง/hook พัง ก็ยังขึ้น (dotpals ทำแล้วด้วย polling 1.5 วิ)
4. **ความปลอดภัยแบบ coucou**: เปิดเฉพาะลิงก์ http/https, จำกัดขนาด/เวลาของ pipe, log ไม่เก็บคำสั่งเต็ม (ตรวจ Awuuu ว่าครบหรือยัง)
5. **เทสต์**: ฝั่ง TS ยังไม่มี; ทั้ง coucou (Swift) และ dotpals (accuracy baseline จากเคสจริง) มี ควรมี test ของ fsm/plan/story และชุดเคสจริงของ hook payload
6. **สถานะ Hermes บน island + onboarding ตรวจ key/URL** (รอบก่อน)
7. **ติดตั้งแบบไม่โดน Defender**: coucou เจอ installer ถูกตีเป็น malware (false positive) เพราะไม่ได้เซ็น ถ้าจะแจกจริงต้องวางแผน code signing

### ลำดับ 3: Integration และหลาย tool
1. **Adapter registry**: ทำให้เพิ่ม agent ใหม่เป็นไฟล์เดียว (id, detect, setup, describeTool) แบบ dotpals แทนการกระจายอยู่ใน hooks.rs/hooks.ts; เพิ่ม **Cursor, Gemini CLI, GitHub Copilot CLI** ที่ dotpals/coucou รองรับแล้ว และ endpoint `/event` ให้ agent ใดๆ ส่ง JSON เข้ามาได้
2. **ปุ่ม Connect/Disconnect/Send test event ต่อ agent**: แสดงว่าติดตั้งไหม เชื่อมไหม event ล่าสุดเมื่อไร; ถอนเฉพาะที่เราเพิ่ม และ backup ก่อนเสมอ (ตรงกับกฎ settings.json ของเรา)
3. **เป็น plugin ของ Claude Code**: `/awuuu:...` ติดตั้งผ่าน marketplace เพื่อให้ onboarding ง่ายกว่าแก้ settings.json
4. **Context ย้อนกลับเข้า agent** (dotpals context-hook): ตอน SessionStart/UserPromptSubmit ฉีดสรุปสั้นๆ ("เมื่อกี้ Codex แก้ billing.ts") ให้ Claude รู้
5. **Local LLM**: ตรวจ Ollama/LM Studio อยู่แล้ว ควรให้ใช้เป็นตัวสรุป/ตัดสินเบื้องหลังได้ด้วย (ข้อ AI 4)
6. **Export**: คัดลอก recap/วันนี้เป็น Markdown พร้อมหลักฐาน (คำสั่ง, ผล, id ของขั้น) สำหรับ standup/PR (Awuuu มี recap แล้ว เพิ่มแนว "ทุกข้อกล่าวอ้างมีหลักฐาน")

### ลำดับ 4: ฟีเจอร์เสริม (ทีละเล็กน้อยก็คุ้ม)
- **Command Bar แบบ vorssaint**: ฮอตคีย์เดียวค้นหา session/ไฟล์/ประวัติ/การกระทำ/คำนวณ/แปลงหน่วย (ทำฝั่ง Windows ด้วย UI ของ island)
- **Scratchpad / จดด่วน**, **clipboard history** ที่ส่งเข้าแชทได้, **Shelf** ว่างไฟล์ไว้ชั่วคราวระหว่างลาก
- **จับเวลา/โฟกัส/พักสายตา** ที่สุนัขเตือน (เข้ากับคาแรกเตอร์)
- **Copy /compact** เมื่อ context ใกล้เต็ม และให้สุนัขกังวลตามเปอร์เซ็นต์ context (dotpals)
- **Pal ที่ปรับแต่งเอง** (Awuuu มีสายพันธุ์/สี/ลายแล้ว เพิ่มสร้างเอง/แชร์ได้)
- ตั้งค่าแบบ "ติดตั้ง/ถอนฟีเจอร์" (Feature hub) ให้คนที่ไม่ใช้ integration ไม่ต้องเห็นของเกะกะ
- หลายภาษา (vorssaint มีหลายสิบภาษา) เริ่มจากไทย/อังกฤษ

## ลำดับลงมือที่แนะนำ
| รอบ | งาน | เหตุผล |
|---|---|---|
| 1 | Persona + markdown ในแชท + บริบทอัตโนมัติ | เห็นผลต่อ "friendly" ทันที ความเสี่ยงต่ำ |
| 2 | Story engine + ตรวจเทสต์ + ground (git) | หัวใจ AI ที่ทำให้ "ใช้งานได้จริง" และเป็น pure logic ทดสอบง่าย |
| 3 | Guard สองไฟล์ + hotkey + test ฝั่ง TS | เสถียรภาพก่อนเพิ่มของ |
| 4 | Adapter registry + Connect UI + Cursor/Gemini/Copilot | ทำให้รองรับ tool เพิ่มได้ถูกและเร็ว |
| 5 | Handoff + context กลับเข้า agent + ตัวตัดสินด้วย Hermes/local | ต่อยอดจากข้อมูลที่เก็บไว้ |
| 6 | Command Bar / scratchpad / ของเล็กๆ | ตกแต่งชีวิตประจำวัน |

## ข้อควรระวัง
- **vorssaint เป็น GPL-3.0**: ดูแนวคิดได้ แต่เขียนเองใหม่ทั้งหมด
- **dotpals ฟีเจอร์ที่ส่งข้อมูลออก** (cloud Jev) ต้องปิดเป็นค่าเริ่มต้น และผ่าน redaction เสมอ ตรงกับกฎ "ไม่มี telemetry"
- รายละเอียดของ dotpals/coucou เป็นที่อ่านจากเอกสารและโค้ดส่วนหัว ยังไม่ได้รันหรือตรวจว่าฟีเจอร์ทำงานจริงตามที่เขียน
