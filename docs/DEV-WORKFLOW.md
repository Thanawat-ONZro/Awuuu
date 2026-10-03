# Dev workflow: จาก branch ถึง build

ใช้กับทุกคนที่เขียนโค้ดให้ Awuuu ทั้งคนและ Claude (cloud หรือในเครื่อง) อ่านคู่กับ [ROADMAP.md](ROADMAP.md) และ `CLAUDE.md`

## ภาพรวม
```
issue/แผน → branch → commit เล็ก → ตรวจในเครื่อง → push → PR (draft) → CI เขียว
  → review → squash merge เข้า main → (ครบเวอร์ชัน) release บนเครื่อง Owen → installer
```

## 1. เลือกงาน
- งานทุกชิ้นมาจาก [ROADMAP.md](ROADMAP.md) อ้างเลข PR เช่น `4.2`
- หนึ่ง PR = หนึ่งเรื่องที่ review ได้ในครั้งเดียว (เป้า < 400 บรรทัดที่เปลี่ยน ไม่นับ test/lockfile)
- งานที่ใหญ่กว่านั้นแตกเป็นหลาย PR ที่แต่ละตัว merge ได้เองและไม่ทำให้แอปพัง

## 2. Branch
- `main` = ปล่อยได้เสมอ ห้าม push ตรง ทุกอย่างผ่าน PR
- ชื่อ branch: `v0.4/4.2-persona` (คน) หรือ `claude/v0.4-4.2-persona` (Claude cloud)
- เริ่มจาก `main` ล่าสุดเสมอ: `git fetch origin main && git checkout -b <branch> origin/main`
- ถ้า main ขยับระหว่างทำ ให้ merge main เข้า branch (ไม่ rebase branch ที่คนอื่นดึงไปแล้ว)

## 3. Commit
- ข้อความ commit ขึ้นต้นด้วยหมวด: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`
- บรรทัดแรก ≤ 72 ตัวอักษร บอกว่าผู้ใช้เห็นอะไรเปลี่ยน
- ห้าม commit key, token, `.env`, ไฟล์ build (`target/`, `dist/`, installer)

## 4. ตรวจในเครื่องก่อน push
จากโฟลเดอร์ `windows/`:

| ตรวจ | คำสั่ง | ที่ไหนรันได้ |
|---|---|---|
| Type check | `npx tsc --noEmit` | ทุก OS |
| TS unit test | `npm test` (vitest) | ทุก OS |
| Rust test | `cargo test --workspace` | Windows เท่านั้น |
| Rust lint | `cargo clippy --workspace -- -D warnings` | Windows เท่านั้น |
| Build frontend + hook | `npm run build` | Windows เท่านั้น |
| Installer | `npm run pack` | Windows เท่านั้น |

Claude บน cloud (Linux) รันได้แค่ `tsc` และ `vitest` จึงต้องพึ่ง CI สำหรับส่วน Rust: push แล้วอ่านผล CI ก่อนเรียกว่าเสร็จ

กฎที่ต้องไม่พัง (จาก `CLAUDE.md`):
- hook ต้อง timeout 300 ms แล้ว exit 0 เสมอ ห้ามบล็อก Claude Code
- ห้ามเขียน `%USERPROFILE%\.claude\settings.json` ตรงๆ: backup + diff + ยืนยันก่อน
- key อยู่ใน Windows Credential Manager เท่านั้น
- ซ่อนแล้วต้อง 0% CPU, หน้าต่างห้ามแย่ง focus
- ไม่มี telemetry; สิ่งที่ส่งออกเครื่องต้อง opt-in และผ่าน redaction

## 5. Pull request
- เปิดเป็น **draft** ทันทีที่ push ครั้งแรก กรอก template: ก่อน/หลัง, ทดสอบอย่างไร, เลข roadmap
- เพิ่มบรรทัดใน `CHANGELOG.md` ใต้ `## [Unreleased]` ภาษาที่ผู้ใช้อ่านเข้าใจ
- งาน UI แนบภาพหรือบอกวิธีลองด้วย `npm run dev` / `windows/dev/*.html`
- เปลี่ยนเป็น Ready for review เมื่อ CI เขียว

## 6. CI (`.github/workflows/ci.yml`)
รันทุก PR เข้า `main` และทุก push ไป `main`:

| Job | Runner | ขั้นตอน |
|---|---|---|
| `web` | ubuntu-latest | `npm ci` → `tsc --noEmit` → `npm test` |
| `windows` | windows-latest | `npm ci` → `cargo clippy` → `cargo test --workspace` → `npm run build` |

- แคช cargo/npm, `concurrency` ยกเลิก run เก่าของ branch เดียวกัน
- CI แดง = งานยังไม่เสร็จ หาสาเหตุจริงแล้วแก้ ห้ามปิด/ข้าม test
- workflow `windows.yml` เดิม (สร้าง installer ด้วยมือ) ยังอยู่สำหรับตรวจ `npm run pack`

## 7. Review และ merge
- Owen เป็นคนอนุมัติและ merge (Claude ไม่ merge เข้า main เอง)
- ใช้ **Squash and merge** ให้ main มี commit ละหนึ่ง PR ชื่อ commit = ชื่อ PR
- ลบ branch หลัง merge
- ตั้ง branch protection ของ `main` (ทำครั้งเดียวที่ GitHub → Settings → Branches): require PR, require status checks `web` และ `windows`

## 8. ปล่อยเวอร์ชัน (บนเครื่อง Windows ของ Owen)
เมื่อ PR ทั้งหมดของเวอร์ชันใน roadmap merge แล้ว:
1. `git checkout main && git pull`
2. ย้ายหัวข้อ `[Unreleased]` ใน `CHANGELOG.md` เป็น `[0.4.0] - YYYY-MM-DD` (PR เล็ก `chore: changelog 0.4.0`)
3. รัน workflow **Windows** ด้วยมือบน GitHub (Actions → Windows → Run workflow) เพื่อยืนยันว่า installer build ได้บนเครื่องสะอาด
4. `cd windows && npm run release -- 0.4.0 "สรุปสั้น"`: bump เวอร์ชันทุกที่, commit, build installer ที่เซ็นด้วย updater key, สร้าง GitHub release `windows-v0.4.0` พร้อม `latest.json`
5. ติดตั้งทับเวอร์ชันเก่าบนเครื่องจริง ลอง: island ขึ้น, hook จาก Claude Code, อนุมัติ, แชท Hermes, ซ่อนแล้ว CPU 0%
6. ถ้าเจอบั๊กหลังปล่อย: PR แก้ → `0.4.1`

## 9. Claude บน cloud ทำงานอย่างไร
- อ่าน `CLAUDE.md`, ROADMAP และไฟล์นี้ก่อนเริ่มทุกงาน
- ทำทีละ PR ตามลำดับใน roadmap: branch → โค้ด + test → `tsc` + `vitest` → push → draft PR → รอ CI → แก้จนเขียว → แจ้ง Owen
- ไม่ merge เอง, ไม่แก้เลขเวอร์ชัน, ไม่สร้าง release
- รายงานงบที่ใช้โดยประมาณเมื่อจบแต่ละเวอร์ชัน
