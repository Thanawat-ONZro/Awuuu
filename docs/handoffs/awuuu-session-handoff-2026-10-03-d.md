# Awuuu — handoff รอบ 4 (2026-10-03 d)

**สถานะ:** ออก **0.3.0** แล้วตามที่ owen สั่ง — push `main` ถึง `f16d712`, release `windows-v0.3.0`
https://github.com/Thanawat-ONZro/Awuuu/releases/tag/windows-v0.3.0
Test: แอป 75, hook 16, TS 7 ผ่านทั้งหมด worktree และ branch `r4-*` ลบแล้ว

วิธีรีวิว: เขียน `(owen: …)` ต่อท้ายข้อที่อยากแก้เหมือนเดิม

---

## 1. ทำอะไรไปบ้าง

### หน้าต่าง Awuuu ใหม่ (dashboard + settings ในหน้าต่างเดียว)
- Sidebar: Sessions · Stats & limits · Getting started · Agents · Chat & models · Integrations · Appearance · Island · Sound & behaviour · Privacy & history · About & aw
- เปิดจาก: ปุ่มเฟืองบนเกาะ (หน้าเดิมที่ค้างไว้), ปุ่ม Dashboard ข้างเฟือง, tray "Dashboard…" / "Settings…", `aw dashboard`, `aw settings`
- หน้า settings เล็กบนเกาะเหลือแค่เสียง, auto-close และปุ่ม "Open Awuuu…"

### ไอเดียจาก dotpals
| เรื่อง | ผล |
|---|---|
| ช่องทางรับ event | ใช้ named pipe ของเราต่อ (ไม่มี port ให้เว็บหรือโปรแกรมอื่นยิงเข้า) ไม่เอา HTTP localhost ของเขา |
| History ในเครื่อง | `%APPDATA%\Awuuu\history.json` เก็บ 7 วัน (ปรับ 1–90), สูงสุด 5000 รายการ, ปิดได้, ล้างได้ ในหน้า Privacy & history |
| Dashboard | Sessions แยกตาม request, ค้นหา, Copy recap สำหรับ PR, Export `.md` + `.json` ลง Downloads, Stats วันนี้ / 7 วัน |
| Live plan | hub แสดง `2/4 · ขั้นที่ทำอยู่` พร้อมแถบ และเลขขั้นบน pill (Claude TodoWrite / TaskCreate, Codex `update_plan`, OpenCode, Gemini) |
| Usage limit | Codex อ่านจากไฟล์ session ในเครื่อง, Claude ผ่าน status line (ติดตั้งจากหน้า Agents) แสดงเป็น chip บน hub และแถบในหน้า Stats |
| แสง | เหลือง pulse ตอนรออนุมัติ, เขียววาบตอนเสร็จ, แดง + สั่นตอน error |
| ยังไม่ทำ | ตัวกันสอง agent แก้ไฟล์เดียวกัน, hand-off ข้าม agent, ตัวตรวจผล test ด้วย AI, live plan บน pill ตอนย่อ |

### ตาม review ของ owen
- **หมา:** 9 preset มีลายจริง (Shiba, Husky, Black & Tan, Dalmatian, Golden, Corgi, Bernese, Samoyed, Pug), หน้า Appearance ปรับสี / ลาย / หู / หาง / ตา / ปลอกคอ, หมาของแต่ละ agent มีรายละเอียด
- **Hub ซ้อนกัน:** แถว pill เลื่อนแนวนอน, × สลับกับ tag ตอน hover, "Clear finished" เป็นปุ่มถังขยะขนาดคงที่
- **ขอบซ้าย/ขวา:** เปิดแล้วเป็นการ์ดแบบขอบบน ลอยห่างขอบ 10 px ไม่มี rail แนวตั้งแล้ว
- **ลาก:** เกาะเริ่มจากตำแหน่งเดิมแล้วไหลตามเมาส์ ไม่กระโดดซ้าย; กด grip เฉยๆ ไม่ถึง 3 px ไม่นับเป็นการลาก
- **Drop:** หลายไฟล์, drop เพิ่มได้, ลบไฟล์ทีละอันก่อนถาม, จำกัด 10 ไฟล์ / 20 MB
- **Ask ไปผิดหน้า:** สาเหตุคือปุ่ม Cancel ที่มองไม่เห็นทับด้านขวาของปุ่ม Ask แก้แล้ว Ask ไปหน้าแชตเสมอ
- **แชต:** ปรับขนาดได้ด้วย grip (ดับเบิลคลิก grip = กลับเป็นสูงอัตโนมัติ), แสดงเฉพาะ provider ที่เชื่อมแล้ว, dropdown ของเราเอง, error แสดงในแชตเลย (ข้อความและไฟล์ไม่หาย)
- **Integrations:** ปุ่ม Sign in with Google / Microsoft, GitHub ผ่าน gh CLI หรือ device code; app password, iCal และ token ย้ายไป "Advanced / other providers"
- **`aw`:** `aw` เปล่าแสดงเมนู, `aw help`, `aw dashboard`, `aw settings`, ข้อความ error บอกขั้นถัดไป

---

## 2. ทดสอบอะไรแล้วบ้าง

**ในแอปจริง (เครื่องนี้)**
- หน้าต่างใหม่เปิดผ่าน `aw dashboard` ได้ หน้า Sessions และ Stats แสดงข้อมูลจริงของ session Claude Code
- `history.json` ถูกเขียนจาก hook จริง
- Codex limit: plan free, Month ใช้ไป 4%
- Claude limit: status line ถูกติดตั้งบนเครื่องนี้แล้ว และ chip บน hub แสดง 5-hour / Week จากค่าจริง
- ลากเกาะด้วย grip: เฟรมแรกหลังกด pill อยู่ที่เดิม ไม่กระโดด (ทดสอบบนขอบบนเท่านั้น)

**เฉพาะ headless Chrome (ยังไม่ได้ลองในแอปจริง)**
- ขอบซ้าย/ขวา/ล่าง, แถว pill 1 / 3 / 7 session, แสงเหลือง/เขียว/แดง
- Drop 3 ไฟล์ → ลบ → Ask → หน้าแชต, dropdown, ปรับขนาดแชต
- หน้า Appearance และหมาทุก preset
- หน้า Integrations ใหม่

**ยังไม่ได้ทดสอบเลย**
- Sign in จริงทุกตัว (ต้องมี client ID ก่อน) และการดึง Gmail / Calendar / Graph
- ลากไฟล์จริงจาก Explorer (OLE) หลังเปลี่ยนเป็นหลายไฟล์
- แชตกับ Hermes / Claude พร้อมหลายไฟล์
- Export, Clear history, Copy recap ในหน้าต่างจริง
- ลากเกาะบนจอที่ scale 125–150% หรือจอที่สอง

---

## 3. ให้ owen ลอง
1. ลากเกาะไปทุกขอบ แล้วเปิด hub / approval บนขอบซ้ายและขวา ดูว่าการ์ดลอยอยู่ในจอ และช่องว่าง 10 px ข้างขอบคลิกทะลุได้
2. ลากไฟล์ 1 ไฟล์และหลายไฟล์จาก Explorer ใส่เกาะตอนซ่อน / ย่อ / เปิด → ลบบางไฟล์ → Ask → พิมพ์ได้ทันที
3. หน้าแชต: รายการ provider ตรงกับที่เชื่อมไว้ไหม, เปิด dropdown ค้างไว้เกาะต้องไม่ปิดเอง
4. Appearance: เปลี่ยนหมาแล้วเกาะเปลี่ยนตามทันที, ปิดเปิดแอปแล้วยังอยู่
5. Sessions: Copy recap แล้ววางใน PR, Export แล้วกด "Show in folder"
6. Privacy & history: ปิด history แล้วทำงานต่อ ไฟล์ต้องไม่โตขึ้น, Clear แล้วไฟล์หาย
7. แสงเหลืองตอนมีคำขออนุมัติ และเขียวตอน session จบ

---

## 4. Sign in: สิ่งที่ owen ต้องทำเอง
ช่องกรอกอยู่ที่ Integrations → "Advanced / other providers" → OAuth client IDs ขั้นตอนละเอียดอยู่ใน `docs/OAUTH-SETUP.md`
- **GitHub (เร็วสุด):** มี `gh` และ `gh auth login` แล้ว กด "Use GitHub CLI login" ไม่ต้องสร้างอะไร
- **GitHub แบบ code:** สร้าง OAuth App ที่ github.com/settings/developers, ติ๊ก "Enable Device Flow", วาง client ID
- **Google:** สร้าง Cloud project → เปิด Gmail API และ Calendar API → consent screen แบบ External + เพิ่มตัวเองเป็น test user → OAuth client ชนิด "Desktop app" → วาง client ID และ secret → Sign in แล้วผ่านหน้า "unverified app" (ถ้าปล่อยเป็น Testing token หมดอายุทุก 7 วัน ต้องกด Publish app)
- **Microsoft:** ลงทะเบียน app ใน Entra (ทุก directory + บัญชีส่วนตัว) → redirect `http://localhost/callback` แบบ Mobile and desktop → Allow public client flows = Yes → สิทธิ์ `User.Read`, `Mail.Read`, `Calendars.Read`, `offline_access` → วาง Application ID

---

## 5. ข้อจำกัดและเรื่องที่ควรรู้
- **Status line เดิม:** ถ้ามี status line เดิมที่เขียนแบบ bash (เช่น `~/…`) ตัวเดิมถูกเรียกต่อผ่าน cmd จึงอาจไม่ทำงาน แล้ว Awuuu จะพิมพ์บรรทัดของตัวเองแทน ถอนได้จากหน้า Agents (คืน status line เดิมให้)
- **Claude limit อัปเดตเฉพาะตอน Claude Code เปิดอยู่** เพราะตัวเลขมาจาก status line
- **Output ของคำสั่งใน history** เก็บแบบย่อ (หัว 1,100 + ท้าย 600 ตัวอักษร) เนื้อหาไฟล์ที่ agent อ่านไม่ถูกเก็บ
- **"N failed" ใน Sessions** นับทุกคำสั่งที่พัง รวมที่ agent แก้ทีหลังแล้ว
- **`aw` คืน exit code 1** เมื่อไม่พบ agent หรือ Awuuu และตรวจว่า agent ติดตั้งอยู่ก่อนเปิด Awuuu
- **เพิ่ม crate `ring`** เป็น dependency ตรง (SHA-256 และเลขสุ่มของ PKCE) มีอยู่ใน tree อยู่แล้วผ่าน rustls
- **เปิดหน้าต่างครั้งแรกหลัง start ด้วย `aw dashboard`** เคยไปหน้า Stats แทน Sessions หนึ่งครั้ง ครั้งถัดมาถูก ยังไม่ได้หาสาเหตุ
- **หน้า Sessions** บางครั้งเลื่อนลงจนหัวหน้าและแถบค้นหาพ้นจอหลังข้อมูลรีเฟรช เลื่อนขึ้นเองได้ ยังไม่ได้แก้
- **`awuuu-hook.exe` ใน `%LOCALAPPDATA%\Awuuu\bin`** copy ทับหลัง build 0.3.0 ไม่ได้เพราะไฟล์ถูกใช้อยู่ ตัวที่ใช้อยู่เป็นของ build ก่อนหน้า 5 นาที (โค้ดเดียวกัน ต่างแค่เลขเวอร์ชัน)

---

## 6. Commit หลักของรอบนี้
- `636b085` หน้าต่างใหม่ + แยกหน้า settings + dropdown
- `34177eb` dashboard (D)
- `cc6fe34`, `4086cec` หมา (E)
- `37a0ead`, `747e83d` usage / plan / history (C)
- `409ab6c` relay ส่ง output แบบย่อ
- `e9fc159`, `7fb50c5` layout เกาะและการลาก (A)
- `7646313` live plan + usage chip บน hub
- `f8fa500`, `aa7930a`, `60c1a88` sign-in, หน้า Integrations, `aw` (F)
- `6fba60e`, `57b9929` drop และ chat (B)
- `f16d712` Release Awuuu 0.3.0

## 7. หมายเหตุการทำงาน
- agent 6 ตัวพร้อมกันทำให้ usage limit ของ session หมดกลางทางหนึ่งครั้ง งานไม่หาย แต่ต้องรอ reset แล้วสั่งทำต่อ รอบหน้าถ้าแบ่ง agent อีก ควรให้ commit เร็วตั้งแต่แรก
- ระหว่างทดสอบการลากครั้งแรก 2 ครั้ง การกดเมาส์ไม่ถึงเกาะ (เกาะยังไม่รับเมาส์) การกดจึงไปลงที่สิ่งที่อยู่ข้างใต้ ไม่เห็นผลเสียในภาพหน้าจอ
