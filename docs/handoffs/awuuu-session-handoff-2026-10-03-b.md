# Awuuu — สรุป session (2026-10-03 รอบ 2)

- **Repo:** `C:\Users\Thanawat_OXYRON\Project\Awuuu` branch `main` (ยังไม่ได้ push ตอนนี้นำหน้า origin 18 commits)
- **แผนของ session นี้:** `C:\Users\Thanawat_OXYRON\.claude\plans\c-users-thanawat-oxyron-downloads-awuuu-functional-codd.md`
- **แอปที่รันอยู่:** `windows\target\release\awuuu.exe` (build ล่าสุด) เปิดผ่าน `explorer.exe` hook ที่ `%LOCALAPPDATA%\Awuuu\bin\awuuu-hook.exe` เป็นตัวล่าสุดแล้ว
- **Installer:** `windows\release\Awuuu-Windows-setup.exe` (ยังเป็นเวอร์ชัน 0.2.0 ยังไม่ได้ bump)
- เทส: `npx tsc --noEmit` ผ่าน, `cargo test -p awuuu -p awuuu-hook` ผ่าน 27 + 8 ตัว

## Commits
| Commit | เรื่อง |
|---|---|
| `4a3787d` | A: hub ใช้สีของ agent ที่เลือก (pill ไม่เสียสีตอนเอาเมาส์ออก), หยุด animation ใน view ที่ปิด (Coucou eb1241f) |
| `d7abca9` | B: log บอกว่ากำลังทำอะไรจริงๆ: ทุก tool call ลง log, ป้ายภาษาอังกฤษ, `toolSummary` ของ AGY, `description` ของ Claude, คำพูดและ thinking จาก transcript, การ์ด approval เปิดเอง |
| `8fa52a1` | C: การ์ดที่ตอบใน terminal ไปแล้วจะหายเอง (Coucou #117), แถบ "request waiting", ลบ view `question`, เทสไม่เขียน log จริง |
| `deca1da` | D+E: ย้ายเกาะ 2 โหมด, ปรับขนาดที่มุม, ตัวเลือก hub |
| `e2bd6cb` | 4+5: Hermes (shell hooks, Runs API, รายการ session) และ OpenCode plugin |
| `a249d6e` | 6: แชตหลาย provider (OpenAI-compatible) |
| `921239d` | 7: integrations เปิดใช้เมื่อมี key, ปุ่ม Test, deep links, event ใหม่ |
| `a8e43c4` … `4bf5e75` | 8: `aw` บน PATH, `aw <agent>`, `aw setup <agent>` (+ แก้ CRLF/find.exe) |
| `3a31bfb` | 9: Codex hooks (Experimental) |

## สิ่งที่ผู้ใช้ต้องลองเอง
1. **ย้ายเกาะ** (เริ่มที่ขอบบนตรงกลาง):
   - ลากที่ grip ⋮⋮ ตรงกลาง header ตอนเกาะเปิด หรือกด **Alt ค้างแล้วลาก**ที่ตัวเกาะ
   - **Edge mode:** ปล่อยแล้วเกาะจะเกาะขอบที่ใกล้สุด (บน/ล่าง/ซ้าย/ขวา) และอยู่ตรงจุดที่ปล่อย ขอบซ้าย/ขวาตอนซ่อนจะเป็นแท็บแนวตั้ง
   - **Free mode:** วางตรงไหนก็ได้ ถ้าใกล้ขอบไม่เกิน 24 px จะ snap เข้าขอบ สลับโหมดได้จาก Settings → Island layout หรือเมนู tray "Switch placement"
   - กลับที่เดิม: Settings → Reset position หรือเมนู tray (owen:เอา free ออกเหลือแค่ Edge mode และจัดการให้ดีๆ คิดถึงสภาพตอนมันอยู่ซ้ายขวา และด้านล่างด้วย เหมือนมันจะบังคับได้แค่แนวนอนเลย พอเป็นแนวตั้งด้านซ้ายขวาพัง และด้านล่างที่ไม่ได้กลับหัวให้มัน)
2. **ขนาด:** ลากมุมของเกาะในหน้า agents หรือใช้ S/M/L/XL หรือ slider ใน Settings (owen: เอา S ออก)
3. **Custom hub:** ขนาดตัวอักษร, จำนวนบรรทัดของ log, แสดง thinking ไหม, แสดงเวลาไหม
4. **ติดตั้ง hooks:** Hermes / OpenCode / Codex ผ่าน Settings (จะมี diff ให้ดูก่อน ผมเปิดดู diff ของ Hermes แล้วกด Cancel ยังไม่ได้เขียนอะไร)
   - Hermes: ครั้งแรกจะถามให้ trust hooks (หรือรัน `hermes hooks list`)
   - Codex: ต้องรัน `/hooks` ใน Codex เพื่อ trust
   - OpenCode: ติดตั้งแล้วต้องรีสตาร์ท OpenCode
(owen: อยากจะให้มีสอนตอนเปิดแอปครั้งแรกเพราะไม่รุ้ว่าต้องจัดการ hook เอง และไม่รู้ว่า aw คืออะไร ใช้ยังไง ต่างจาก hook ยังไง)
5. **`aw`:** Settings → "Add aw to PATH" แล้วเปิด terminal ใหม่ ลอง `aw claude`, `aw setup hermes`
6. **Integrations:** แค่บันทึก key แล้ว pill จะขึ้นเอง กด Test ได้ แถวในการ์ดกดแล้วเปิดเว็บที่เกี่ยวข้อง(owen: ยังไม่ได้มีประโยชน์ขนาดนั้น ขนาด รูปแบบการใช้งาน ออกแบบการเอาไปใช้งานของมันใหม่หน่อยมันยังดูไร้ประโยชน์ และทำให้มันต่อสิ่งทื่มีประโยชน์ได้มากกว่านี้ ยกตัวอย่างนะ google mail ไรงี้ หรืออื่นๆ ออกแบบส่วนนี้ให้หน่อย)

## สิ่งที่ทดสอบกับของจริงแล้ว
- AGY ทำงานจริง (`agy -p` ภาษาไทย) การ์ดขึ้นเอง กด Allow จากเกาะ log แสดง Read/Run/Write, thinking และคำตอบภาษาไทย แล้วขึ้น "Done" (owen:ตอนที่มันว่างแล้วฉันจะพิมพ์ข้อความให้มัน มันไม่ได้ Syc กันใน  cli เหมือนจะเป็นข้อจำกัดใช่ไหมหรือยังไงไม่รู้ ถ้าแก้ได้ก็อยากให้แก้ แต่ awuuu ต้องแก้ตาม agent นะ มันควรจะติดตั้ง awuuu แล้วใช้ได้เลย ถ้ามันทำพร้อมกันไม่ได้ เอา feature พิมพ์แชทใน session terminal ออกไปเถอะ ทำเหมือน claude ที่มีแค่ log แสดงคำอธิบายของคำสั่ง, ข้อความและ thinking ของ Claude)
- Claude Code (session นี้เอง) log แสดงคำอธิบายของคำสั่ง, ข้อความและ thinking ของ Claude (อ่านจาก transcript)
- ย้าย: ลากตามขอบบน, Alt+drag ไปขอบซ้าย (มีแท็บแนวตั้ง และเปิดจากแท็บได้), Free mode ลอยกลางจอ, resize ที่มุมแล้วบันทึกได้
- Hermes: Runs API กับ gateway จริง (`pong`), payload ของ shell hook ผ่าน relay แล้ว session สีม่วงขึ้นใน hub (owen: ออกแบบมาดีเหมือนจะใช้ได้จรีง แต่ตอนที่กดที่หมาสีต่างๆมันไม่เปลี่ยนด้วยความน่ารักหายไปแล้ว แล้วก็พอเปิดมาหลายๆ session มันลบไม่ได้อะ แล้วก็มีปัญหาคือ คุยในหน้าของแชทที่ต่อกับ Hermes gateway อยู่ พอพิมพ์แชทไป มันเด้งมาหน้า terminal session เฉยเลย)
- OpenCode: plugin ที่รันบน Node + mock client แล้วส่ง event จริงเข้าเกาะ การ์ด permission ขึ้น กด Allow แล้ว plugin ได้ `allow`
- `--settings=hermes` เปิด Settings ไปที่ส่วน Hermes, `aw.cmd help/setup/agy` ทำงาน (owen:ยังไม่ได้ลองเลย ทำให้สมบูรณ์ก่อนแล้วค่อยบอก ให้เช้คอีกทีว่าแก้ไรได้อีก อย่าลืม awuuu ต้องตาม agent)

## ยังไม่ได้ทดสอบกับของจริง / ข้าม
- **Drag & drop ไฟล์:** ข้าม (เคยลองหลายรอบใน session ก่อน config ถูกต้อง แต่ปัญหาอยู่ใน OLE/WebView2) ทางเลือกต่อไปที่ยังไม่ได้ลอง: ไม่ revoke target ของ `Chrome_RenderWidgetHostHWND` บนเกาะ แล้วรับ drop ผ่าน HTML5 (`dragover`/`drop` + File API) แล้วส่ง bytes ไปให้ Rust (owen: ในของต้นฉบับ https://github.com/louis-cfm/coucou เขาทำได้จริงนะ ลองไปดูว่าเขาทำยังไงอาจจะทำเป็นแบบได้ อยากจะให้แบบ ลากไฟล์ พอไปใกล้ๆกับ awuuu จากที่มันhide เล็กสุดอยู่ก็ให้ขยายแล้วเปลี่ยนหน้ามารับไฟล์ )
- **Codex:** ยังไม่ได้ลองกับ session จริง (ต้อง trust hooks ก่อน) จึงติดป้าย Experimental
- **Hermes shell hooks:** ยังไม่ได้ลองกับ CLI จริง เพราะต้องเขียน config.yaml ของผู้ใช้
- **Chat หลาย provider:** ในเครื่องไม่มี Ollama/LM Studio รันอยู่ ตัวเลือกใน Settings ยังไม่ได้เห็นบนหน้าจอจริง
- **Integrations:** ไม่มี key ให้ลอง event ใหม่ (Stripe ล้มเหลว, GitHub Actions, Resend bounce, Cal.com) จึงตรวจด้วย unit test กับ typecheck เท่านั้น
- Hermes ไม่มีวิธีให้ hook ตอบ approval ใน CLI (`pre_approval_request` สังเกตได้อย่างเดียว) เกาะจึงแค่แจ้งว่า "Waiting for your approval in Hermes" แต่ถ้าแชตผ่านเกาะ (Runs API) จะตอบได้จากการ์ดจริง (owen: ถ้าเป็นข้อจำกัดก็โอเค ที่เหลือแค่ทำให้แน่ใจว่มันจะไม่บัค)

## เหตุการณ์ระหว่างเทสที่ควรรู้
- ตอนลองโหมด Free ผมคลิกพลาดแท็บไปโดนลิงก์ในหน้า GitHub (Louis-CFM/coucou) ทำให้แท็บนั้นไปเปิดหน้า commit และมีการเลือกข้อความบนหน้าเว็บ ไม่มีอะไรเสียหาย
- ทดสอบ Runs API ครั้งเดียวด้วย session ชื่อ `awuuu-test-runs` ใน Hermes (ลบได้ถ้าไม่ต้องการ)
- ตอนแก้ `settings.json` ของ Awuuu ด้วย PowerShell มี BOM ทำให้แอปอ่านไฟล์ไม่ได้ ไฟล์ไม่ได้หายไป แก้แล้ว และตอนนี้แอปอ่านไฟล์ที่มี BOM ได้

## ต่อไป
- ผู้ใช้ลองย้าย, ปรับขนาด และ custom แล้วบอกผล (owen: ทำออกมาดูดีนะแต่เหมือนที่เคยบอก ไม่ได้รองรับการอยู่ซ้ายขวาและด้านล่างขนาดนั้น ยังบัคๆ ลองดูดีๆ)
- ติดตั้ง hooks ของ Hermes, OpenCode และ Codex จาก Settings แล้วทดสอบกับของจริง
- push และ release `npm run release -- 0.3.0 "…"` เมื่อผู้ใช้สั่ง

เพิ่มเติมจาก owen
หน้าต่่างแชท อยากจะให้แก้เปลี่ยน model ได้ และบอกว่าตอนนี้ใช้อะไรอยู่ low หรืออะไร ตาม api ที่ต่อที่ใช้จริงเลย
อยากจะให้ตอนที่แจ้งเตือนแล้วขึ้นว่า Open teminal อยากกดแล้วเด้งไปที่ terminal session นั้่นจริงๆ ไม่ใช่ vscode 
theme น้องหมาสีขาวส้มตอนนี้หายไปแล้ว เหลือแต่สีแดง อยากให้ base เป็นสีขาวหรือส้ม ตามตัวเดิมอะ จำสีไม่ได้ ตัวเดิมตอนรัน awuuu ขึ้นมาแล้วมีหมามาต้อนรับ อยากให้อยู่ในหน้า chat และ drop file อยากให้ หมามารับไฟล์ด้วย ทำให้ feature ใช้งานได้แบบมีประโยชน์
terminal session อยากจะให้ ลบ session นั้นๆได้ 
หน้า chat bot คุยกับ hermes แต่สีเป็นสีแดงของ claude 
ยังไม่มีเอฟเฟคตอนลาก อยากจะเป็นเหมือนน้ำที่ถูกดึงออกจากผิว อันนี้ตอนดึงออกมา แล้วลากนะ แล้วพอไปใกล้ๆ ก็อยากจะให้เหมือนกำลังจะเชื่อมกลับเข้าไปขอบจอ ออกแบบอนิเมชั่นการย้ายที่ใหม่

