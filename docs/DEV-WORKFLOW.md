# Dev workflow: จาก branch ถึง build

ใช้กับทุกคนที่เขียนโค้ดให้ Awuuu ทั้งคนและ Claude (cloud หรือในเครื่อง) อ่านคู่กับ [ROADMAP.md](ROADMAP.md) และ `CLAUDE.md`

## ภาพรวม
```
issue/แผน → branch → commit เล็ก → check-cloud.sh ผ่าน → push → PR (draft)
  → review → squash merge เข้า main → (ครบเวอร์ชัน) pack + release บนเครื่อง Owen → installer
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

## 4. ตรวจก่อน push (แทน CI)
ไม่ใช้ GitHub Actions (ไม่มีเครดิต) การตรวจทั้งหมดเกิดก่อน push

**บน cloud (Claude)** จากโฟลเดอร์ `windows/`:
```bash
bash scripts/check-cloud.sh
```
สคริปต์นี้ติดตั้ง mingw + wine ถ้ายังไม่มี แล้วรัน:

| ตรวจ | วิธี |
|---|---|
| Type check | `tsc --noEmit` |
| TS unit test | `npm test` (vitest, ไฟล์ใน `windows/test/`) |
| Rust compile | `cargo check --target x86_64-pc-windows-gnu` (cross-compile) |
| Rust test | build เป็น .exe ของ Windows แล้วรันด้วย wine (app 75 ตัว, hook 15 ตัว) |

ข้อจำกัดของ cloud: ตรวจ MSVC linker, installer, WebView2 จริง และหน้าต่างบนจอไม่ได้ test `waitfor` ของ hook ข้ามไว้เพราะ wine ไม่มีคำสั่งนี้

**บน Windows (Owen)** จาก `windows/` เมื่ออยากลองของจริงหรือก่อนปล่อยเวอร์ชัน:
```powershell
npx tsc --noEmit; cargo test --workspace; npm run tauri dev   # ลองใช้
npm run pack                                                 # installer
```

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
- เปลี่ยนเป็น Ready for review เมื่อ `check-cloud.sh` ผ่าน

## 6. ไม่มี CI บน GitHub
- ไม่มี workflow ที่รันอัตโนมัติ (`windows.yml` เดิมกดรันมือเท่านั้น และไม่ต้องใช้)
- PR ทุกตัวต้องแนบผลบรรทัดท้ายของ `check-cloud.sh` ("All checks passed") ใน description
- ผลตรวจแดง = งานยังไม่เสร็จ หาสาเหตุจริงแล้วแก้ ห้ามปิด/ข้าม test
- ถ้าวันหนึ่ง repo เป็น public นาที Actions จะฟรี ค่อยย้ายสคริปต์นี้ไปเป็น CI ได้ทันที

## 7. Review และ merge
- Owen เป็นคนอนุมัติและ merge (Claude ไม่ merge เข้า main เอง)
- ใช้ **Squash and merge** ให้ main มี commit ละหนึ่ง PR ชื่อ commit = ชื่อ PR
- ลบ branch หลัง merge
- ตั้ง branch protection ของ `main` (ทำครั้งเดียวที่ GitHub → Settings → Branches): require PR ก่อน merge

## 8. ปล่อยเวอร์ชัน (บนเครื่อง Windows ของ Owen)
เมื่อ PR ทั้งหมดของเวอร์ชันใน roadmap merge แล้ว:
1. `git checkout main && git pull`
2. ย้ายหัวข้อ `[Unreleased]` ใน `CHANGELOG.md` เป็น `[0.4.0] - YYYY-MM-DD` (PR เล็ก `chore: changelog 0.4.0`)
3. `cd windows && npm ci && cargo test --workspace && npm run pack` บนเครื่องตัวเอง เพื่อยืนยันว่า test ผ่านบน Windows จริงและ installer build ได้
4. `cd windows && npm run release -- 0.4.0 "สรุปสั้น"`: bump เวอร์ชันทุกที่, commit, build installer ที่เซ็นด้วย updater key, สร้าง GitHub release `windows-v0.4.0` พร้อม `latest.json`
5. ติดตั้งทับเวอร์ชันเก่าบนเครื่องจริง ลอง: island ขึ้น, hook จาก Claude Code, อนุมัติ, แชท Hermes, ซ่อนแล้ว CPU 0%
6. ถ้าเจอบั๊กหลังปล่อย: PR แก้ → `0.4.1`

## 9. Claude บน cloud ทำงานอย่างไร
- อ่าน `CLAUDE.md`, ROADMAP และไฟล์นี้ก่อนเริ่มทุกงาน
- ทำทีละ PR ตามลำดับใน roadmap: branch → โค้ด + test → `check-cloud.sh` จนผ่าน → push → draft PR → แจ้ง Owen
- เมื่อ Owen สั่งให้ทำต่อเนื่องโดยไม่รอ merge: หนึ่ง branch และหนึ่ง PR ต่อเวอร์ชัน (`claude/v0.4`, `claude/v0.5`, ...) แต่ละข้อใน roadmap เป็นหนึ่ง commit เวอร์ชันถัดไปแตก branch จากเวอร์ชันก่อนหน้า Owen merge ตามลำดับเลขเวอร์ชัน
- ไม่ merge เอง, ไม่แก้เลขเวอร์ชัน, ไม่สร้าง release
- รายงานงบที่ใช้โดยประมาณเมื่อจบแต่ละเวอร์ชัน
