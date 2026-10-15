# Awuuu — สรุป session (2026-10-02 → 03) และแผนต่อ

ไฟล์นี้ใช้ส่งต่อให้ session ใหม่ อ่านไฟล์นี้ก่อน แล้วค่อยอ่านแผนเดิม

- **Repo:** `C:\Users\Thanawat_OXYRON\Project\Awuuu` (แอป Tauri 2 อยู่ใน `windows/`)
- **Branch:** `main` นำหน้า `origin/main` อยู่ **6 commits ที่ยังไม่ได้ push**
- **แผนเดิมฉบับเต็ม (Phase 0–9):** `C:\Users\Thanawat_OXYRON\.claude\plans\1-3-whimsical-perlis.md`
- **แผนต่อจาก session นี้:** `C:\Users\Thanawat_OXYRON\.claude\plans\woolly-rolling-feather.md`
- **กติกาของ repo:** `Project\Awuuu\CLAUDE.md` สรุปสั้นๆ:
  - ห้ามทำให้ agent ค้าง: hook ต้อง exit 0 เสมอ
  - settings ของ agent: ต้อง backup → diff → ให้ผู้ใช้ยืนยันก่อนเขียน
  - secrets เก็บใน Credential Manager
  - CPU ต้องเป็น 0% ตอนว่าง
  - ไม่มี telemetry

---

## 1. สถานะตามแผน

| Phase | เรื่อง | สถานะ | Commit |
|---|---|---|---|
| 0 | ลบไฟล์ Coucou, dead code, ซ่อนเมื่อว่าง = 5 วินาที | ✅ เสร็จ | `b31ec8f` |
| 1 | ดักเมาส์แบบ event (`WH_MOUSE_LL`) ให้ CPU เป็น 0% จริง | ✅ เสร็จ (drop file ยังเสีย ดูหัวข้อ 4) | `372c313` |
| 2 | flag `--agent` + protocol ส่งคำตอบกลับ | ✅ เสร็จ และยืนยันกับของจริงแล้ว | `54b3fbe` |
| 2.5 | การ์ดยืดหดตามเนื้อหา (auto-fit) | ✅ เสร็จ | `259a80a` |
| 3 | AGY hooks รูปแบบที่ถูก + ส่ง prompt หา AGY | ✅ เสร็จ | `29dff5f`, `1b0b5df` |
| 3.5 | ตอบ `ask_question` ของ AGY จากการ์ด, `force_ask`, Agents hub ใหญ่ขึ้น | ✅ เสร็จ | `1b0b5df` |
| — | **ปรับขนาดเกาะเอง** (ผู้ใช้ขอเพิ่ม) | ⏳ ยังไม่ทำ | — |
| — | **ภาษาของ UI** (ผู้ใช้บ่นเรื่องใช้ภาษาอังกฤษ) | ❓ รอผู้ใช้ตอบ | — |
| — | **Drag & drop ไฟล์** | ⏸ ผู้ใช้สั่งพักไว้ | — |
| 4 | Hermes เต็มรูปแบบ (shell hooks, Runs API, รายการ session, `hermes.rs`) | ⏳ | — |
| 5 | OpenCode plugin | ⏳ | — |
| 6 | Chat หลาย provider (OpenAI-compatible) | ⏳ | — |
| 7 | Integrations: เปิดใช้เมื่อมี key, ปุ่ม Test, deep links | ⏳ | — |
| 8 | `aw` บน PATH + `--settings=<agent>` | ⏳ | — |
| 9 | Codex (ฉบับร่าง, Experimental, ทำท้ายสุด) | ⏳ | — |
| Release | `npm run release -- 0.3.0 "…"` หลังทุก phase ผ่าน | ⏳ | — |

---

## 2. สิ่งที่ทำในแต่ละ commit (รายละเอียด)

### `b31ec8f` Phase 0: ลบของเหลือจาก Coucou
- ลบ `docs/` ทั้งหมด (SPEC, INTEGRATIONS, หน้าเว็บ, media), `CONTRIBUTING.md`, `windows/README.md` (ย้ายขั้นตอน build ไปไว้ใน README ที่ root) และ `aw.ps1` (เหลือแค่ `aw.cmd`)
- ซ่อนเมื่อว่าง ค่าเริ่มต้น = **5 วินาที** ทุกที่: `settings.rs`, `state.ts`, `settings/main.ts` และ `applySettings()` อัปเดต `fsm.toastDelay` ด้วย
- ลบ dead code:
  - `hooks_status/preview/apply` แบบเก่า
  - `absence_interval`
  - `TOGGLEABLE_INTEGRATION_IDS` / `toggleIntegration`
  - branch `integration_claude`
- `HookAgent::parse` เลิกรับ `"gemini"` เป็นชื่อเล่นของ AGY
- **บั๊กจริงที่แก้:** `ensure_hook_exe` หาไฟล์ `coucou-hook.exe` ทั้งที่ installer ติดตั้ง `awuuu-hook.exe`
- เปลี่ยนชื่อ comment, ชื่อ pipe และ path ของ log จาก coucou เป็น awuuu
- จุดที่จงใจเก็บไว้: `hooks.rs` ยัง match `coucou-hook` ไว้ลบ entry ของ install สมัย Coucou
- build ของ session ก่อนค้างอยู่เพราะ `lib.rs` เรียก `hooks::status()` ซึ่งตอนนี้เป็น `#[cfg(test)]` แก้เป็น `status_for(HookAgent::Claude)`

### `372c313` Phase 1: ดักเมาส์แบบ event
- ไฟล์ใหม่ `src-tauri/src/mouse.rs`:
  - thread ของตัวเองติดตั้ง `WH_MOUSE_LL` แล้ววน `GetMessageW`
  - callback ทำแค่ `try_send(Event)` เข้า `sync_channel(256)` แล้วเรียก `CallNextHookEx` ทันที
  - มี `mouse::poke()` สำหรับสั่งให้ reader ประเมินใหม่ โดยไม่ต้องรอเมาส์ขยับ
- ใน `island.rs`, `spawn_cursor_poll` ถูกแทนด้วย `spawn_mouse_watch` และ struct `Watch`:
  - block อยู่บน `recv()`, รวม move ที่ค้างคิวเหลือตัวล่าสุด, ส่ง `cursor` ไม่เกิน 60 ครั้ง/วินาที (เก็บตำแหน่งที่ค้างไว้ส่งทีหลังด้วย `recv_timeout`)
  - cache geometry 100 ms, เช็กการเปลี่ยนจอทุก ≤500 ms
  - logic เหมือนเดิมทุกอย่าง: hit test, click-through, click-outside, drag-in, notch hover/click
- `PollGate` เลิกใช้ condvar แล้ว ตอนนี้ `set_rect`, `forget_ignore_state` และ `set_active` จะเรียก `mouse::poke()`
- `Cargo.toml` เพิ่ม feature `Win32_System_LibraryLoader`
- **ผลวัด CPU:** เดิม ~9.7% ของหนึ่ง core → ตอนนี้ ~0.8–1.25% ระหว่างที่เมาส์ขยับ และ ~0 ตอนเมาส์นิ่ง
- แก้ทีหลังใน `54b3fbe`: บันทึกการกดเมาส์ในทุกโหมด รวมตอนเกาะยุบอยู่ และเรียก `unblock_webview_drops` ทุกครั้งที่กด และตอนเกาะเปิดกลางการลากไฟล์ มี log `file drag reached the island`

### `54b3fbe` Phase 2: `--agent` + คำตอบ
- `hook/src/main.rs`:
  - `awuuu-hook [--agent claude|agy|hermes|opencode|codex] <Event>` วาง flag ตำแหน่งไหนก็ได้ (มี `parse_args`)
  - hook ใส่ `agent_source` ให้เอง ถ้าไม่มี flag: payload ที่หน้าตาเหมือน AGY (มี `conversationId`/`toolCall`) นับเป็น `agy` ที่เหลือนับเป็น `claude` (รองรับ install เก่า)
  - `Wait` มี 3 แบบ (ตัว `Query` เพิ่มใน `29dff5f`):
    - `Nothing` (ยิงแล้วจบ)
    - `Decision` (รอให้คนกด สูงสุด 110 วินาที)
    - `Query` (ตอบทันที สูงสุด 1.5 วินาที)
  - `parse_answer` รับทั้ง JSON line `{"decision","answers","reason"}` และคำเดี่ยวแบบเก่า (`allow`/`deny`)
  - `output_json(agent, answer, tool_input, shown_in_island)`:
    - **Claude:** `hookSpecificOutput.decision`: allow / deny(message) / allow + `updatedInput` (= tool_input เดิม + `answers`) สำหรับ AskUserQuestion **ยืนยันกับ Claude Code 2.1.283 แล้ว**
    - **AGY:** ดูหัวข้อ 3
- ในตัวแอป:
  - `pipe.rs` ส่ง `Reply::Decision(Value)` เป็น JSON line
  - `pipe::answer(app, id, decision, answers, reason)`
  - command `approval_decision` รับ `answers` และ `reason`
- installer (`hooks.rs` `hook_command`) ใส่ `--agent claude` / `--agent agy` ทุกคำสั่ง
- Frontend:
  - `AgentSource = "claude"|"agy"|"hermes"|"opencode"|"codex"|"integration"` (เดิม `claudeCode`/`n8n`) ชื่อและสีอยู่ใน `AGENT_INFO` / `agentInfo()` ใน `state.ts`
  - `island/hooks.ts` เชื่อแค่ `agent_source` ตัดการเดาจาก session_id/cwd ทิ้ง
  - การ์ดคำถาม (`views.ts` `buildApproval`):
    - ทำหลายคำถามทีละข้อ
    - multi-select ใช้ปุ่ม Next/Send
    - มีช่องพิมพ์ "Other" ที่ขอ focus ผ่าน `Bridge.focusWindow(true)` ตอน mousedown และคืนตอน blur
    - ปุ่ม "Answer in terminal" = `approvalDecline` (คำตอบไม่ไปไหน agent จะถามใน UI ของตัวเอง)
  - คำถามไม่ถูก auto-allow ด้วยกฎ "Always allow"

### `259a80a` การ์ดยืดหดตามเนื้อหา
- `layout.ts` `approvalHeight(fit)` = `HEADER_BOTTOM(42) + fit + 14` บีบอยู่ระหว่าง 160 ถึง `PANEL_H - 12`
- `State.approvalFit` วัดใน `buildApproval` ด้วยฟังก์ชัน `fit()` ซึ่งรวม `offsetHeight` ของลูก + gap + padding แล้วเรียก `onApprovalHeightChange` → `island.animateGeometry`
- stack ใช้ `overflow-y:auto; justify-content: safe center`
- ผู้ใช้ตอบว่า "Fits well"

### `29dff5f` Phase 3: AGY
- **spec ของ AGY hooks ดึงมาจากเอกสารที่ฝังใน `agy.exe` 1.2.14** (`%LOCALAPPDATA%\agy\bin\agy.exe`):
  - ไฟล์ global คือ `~/.gemini/config/hooks.json` (changelog 1.0.8 ยืนยันว่าเป็นไฟล์ร่วม ส่วน `antigravity-cli/hooks.json` เป็นที่เก่า) และระดับ workspace คือ `.agents/hooks.json`
  - รูปแบบ: key ชั้นนอกเป็นชื่อ hook → `{"enabled", "PreToolUse":[{"matcher","hooks":[{type,command,timeout}]}], "PostToolUse":[…], "PreInvocation":[{handler}], "PostInvocation":[…], "Stop":[…]}`
  - **ไม่มี** event `SessionStart`
  - stdin เป็น camelCase: `conversationId`, `workspacePaths`, `toolCall{name,args}`, `stepIdx` เป็นต้น
  - output ของ PreToolUse: `decision` = `allow|deny|ask|force_ask` และมี `reason`, `permissionOverrides`, `overwrite`
  - PreInvocation/PostInvocation: `injectSteps:[{userMessage|ephemeralMessage|toolCall}]`
  - Stop: `{"decision":"continue","reason"}`
  - hook ทุกตัวต้องพิมพ์ JSON object ออก stdout
  - คำสั่งรันผ่าน `cmd /c`
- `hooks.rs` `merged_for_agent(Agy)` เขียน key `"awuuu"`:
  - `PreToolUse` (timeout 120) และ `PostToolUse` ห่อด้วย matcher `"*"`
  - `PreInvocation`, `PostInvocation`, `Stop` เป็น list แบน
- `without_ours_for_agent` ลบ key `awuuu` และ block `"hooks"` รูปแบบเก่าที่ผิด
- `is_installed_for_agent(Agy)` นับเฉพาะรูปแบบใหม่ มีเทส `agy_hooks_follow_the_bundled_spec`
- **บั๊กที่เจอจากการเทสจริง:** AGY (Go) escape `"` เป็น `\"` ตอนส่งให้ `cmd /c` ทำให้ path ที่มี quote หาไม่เจอ ตอนนี้จึง**ไม่ใส่ quote** ถ้ามีช่องว่างจะใช้ 8.3 short path (`short_path()` ผ่าน `GetShortPathNameW`, feature `Win32_Storage_FileSystem`)
- hook พิมพ์ `{}` สำหรับ event ของ AGY ที่ไม่ได้ตัดสินใจอะไร
- **ส่ง prompt หา AGY** (`src-tauri/src/agents.rs`, command `agent_send(agent, session, text, cwd, busy)` คืน `"queued"|"started"`):
  - **ใช้ `agy agentapi send-message` จากข้างนอกไม่ได้** เพราะต้องมี `ANTIGRAVITY_LS_ADDRESS` ซึ่ง hook ไม่ได้รับมา (hook ได้แค่ `ANTIGRAVITY_CONVERSATION_ID`)
  - session กำลังทำงาน (`busy`): เข้าคิว (`QUEUE` ใน agents.rs) แล้ว `pipe.rs` ส่งออกตอน AGY `PreInvocation` → `{"injectSteps":[{"userMessage":…}]}` หรือตอน `Stop` → `{"decision":"continue","reason":…}`
  - session ว่าง: `agy --conversation <id> -p "<text>"` ใน cwd ของ session (ไม่มีหน้าต่าง) **ทดสอบแล้วว่ายังจำบริบท conversation เดิม**
- hook ตอบ PreInvocation ได้ใน 35 ms ตอน Awuuu เปิด และ 123 ms ตอนปิด

### `1b0b5df` คำถามของ AGY + force_ask + Agents hub
- **`ask_question` ของ AGY** มี payload `toolCall.args.questions[] = {question, options: string[], is_multi_select}` (ดักจาก payload จริง)
  - `hooks.ts` `questionItems()` แปลงเป็นการ์ดคำถาม
  - hook ตอบ `{"decision":"deny","reason":"The user already answered this question in Awuuu (do not ask it again). Q: A"}` เพราะ tool นี้ไม่มี field สำหรับใส่คำตอบ
  - **ยืนยัน end-to-end แล้ว:** ผู้ใช้เลือก Red ที่การ์ด แล้ว AGY ตอบว่า "You picked Red"
- **`force_ask`:** ใช้ static `REACHED_ISLAND` ใน hook
  - ส่งถึง Awuuu แล้วแต่ไม่มีใครตอบ หรือกด "Answer in terminal" → `force_ask` (ในโหมด `toolPermission=always-proceed` ซึ่งผู้ใช้ตั้งไว้ `ask` จะรันต่อเลย)
  - Awuuu ปิดอยู่ → `ask`
- **Agents hub เขียนใหม่** (`buildAgentsHub`):
  - คอลัมน์เดียวกว้างเต็ม สูง 290 (`VIEW_LAYOUTS.agents = {height: 290, botY: 92}`)
  - มี pills (`.hub-pills`), ชื่อ/agent/สถานะ (`.hub-who`), 8 ขั้นตอนล่าสุด (`.hub-steps`) และช่อง prompt (`.hub-prompt`, แสดงเฉพาะ `SENDABLE_SOURCES = {"agy"}`)
  - ลบ `views/ticker.ts` และ CSS ของ ticker แล้ว (`.shimmer` ยังเก็บไว้)

---

## 3. พฤติกรรม hook ตอนนี้ (ตารางอ้างอิง)

| Agent / event | hook รอไหม | stdout |
|---|---|---|
| Claude `PermissionRequest` | รอคนกด ≤110 วินาที | allow / deny / allow+`updatedInput.answers`; ไม่มีคำตอบ → ไม่พิมพ์อะไร (Claude ถามใน terminal) |
| Claude event อื่น | ไม่รอ | ไม่พิมพ์อะไร |
| AGY `PreToolUse` | รอคนกด ≤110 วินาที | allow / deny(reason) / deny(reason=คำตอบ) สำหรับ ask_question / `force_ask` / `ask` (Awuuu ปิด) |
| AGY `PreInvocation` | Query ≤1.5 วินาที | `{}` หรือ `injectSteps` (prompt ที่อยู่ในคิว) |
| AGY `Stop` | Query ≤1.5 วินาที | `{}` หรือ `continue` + reason (prompt ที่อยู่ในคิว) |
| AGY `PostToolUse` / `PostInvocation` | ไม่รอ | `{}` |

pipe: `\\.\pipe\awuuu-<SID>` ฝั่งแอปรอ ack 800 ms แล้วรอการตัดสินใจ 108 วินาที

---

## 4. ปัญหาที่ยังค้าง / สิ่งที่ต้องรู้

### Drag & drop ไฟล์ยังใช้ไม่ได้ (ผู้ใช้สั่งพักไว้)
- **ต้นเหตุที่ 1 (แก้แล้ว):** shell ของ Claude Code บนเครื่องนี้รัน **elevated (High integrity)** ถ้าเปิด `awuuu.exe` จาก shell นี้ แอปจะเป็น admin ไปด้วย และ Windows UIPI จะบล็อกการลากไฟล์จาก Explorer **ต้องเปิดแอปผ่าน `explorer.exe "<path>\awuuu.exe"` เสมอ** (เปิดแล้วจะเป็น Medium integrity)
- **ยังเสียอยู่แม้แอปไม่ใช่ admin:**
  - ฝั่ง Rust log `file drag reached the island` แปลว่าหน้าต่างรับเมาส์แล้ว แต่ frontend **ไม่ได้รับ** `drag enter` จาก Tauri เลย
  - ผลตรวจ window tree ของเกาะ:
    - `Tauri Window` drop=True
    - `WRY_WEBVIEW` drop=False
    - `Chrome_WidgetWin_0` drop=True (ตัวนี้คือของ wry)
    - `Chrome_WidgetWin_1` drop=False
    - `Chrome_RenderWidgetHostHWND` drop=False, exstyle `0x20` (WS_EX_TRANSPARENT)
    - `Intermediate D3D Window` drop=False
  - หน้าต่าง Settings ยังมี drop=True ที่ `Chrome_WidgetWin_1` และ `Intermediate D3D Window` (ไม่ได้ถูก revoke) ส่วนเกาะไม่มี
  - สมมติฐานที่ยังไม่ได้พิสูจน์: OLE ไม่เดินขึ้นไปถึงตัวของ wry, `unblock_webview_drops` revoke มากเกินไป หรือ WebView2 ลงทะเบียนใหม่ทีหลัง
- **เครื่องมือเทส:** สคริปต์ PowerShell WinForms ที่ทำ OLE drag จริง (`DoDragDrop` ไฟล์ จากนั้นใช้ `SetCursorPos`/`mouse_event` เลื่อนไปที่ notch แล้วเข้าไปในเกาะ แล้วปล่อย) ต้องเริ่ม drag ใน handler `MouseDown` และรันแบบ Medium ผ่าน `explorer.exe <file>.cmd`
  - ตัวเดิมอยู่ใน scratchpad ของ session (`...\scratchpad\dragtest.ps1`, `dragtest.cmd`) ซึ่งอาจถูกลบไปแล้ว
  - ระวัง: สคริปต์นี้ยึดเมาส์ผู้ใช้ ~3 วินาที และถ้าค้างให้ส่ง `mouse_event(4)` (left up) คืน

### ปรับขนาดเกาะเอง (ผู้ใช้ขอ ยังไม่ทำ)
- ผู้ใช้อยากให้ปรับขนาดได้ทั้ง**ด้วยมือ**และ**อัตโนมัติ** (ทำ auto-fit ของการ์ด approval ไปแล้ว)
- ข้อจำกัด: หน้าต่างล็อกไว้ที่ `PANEL_W/PANEL_H` = 720×320 (`island.rs` และ `layout.ts`)
- ไอเดีย: ลากขอบล่างของเกาะเพื่อตั้งความสูง/ความกว้างที่ชอบ แล้วเก็บใน settings หรือมีตัวเลือกขนาด S/M/L ใน Settings ซึ่งต้องทำให้ขนาดหน้าต่างเปลี่ยนตามได้
- ผู้ใช้ยังบ่นว่า "หน้า terminal session เล็กไป, การแบ่งซ้าย/ขวาอาจไม่ work" แก้ hub ไปแล้วใน `1b0b5df` แต่**ผู้ใช้ยังไม่ได้ดูผล**

### ภาษา (รอผู้ใช้ตอบ)
- ผู้ใช้พูดถึง "การใช้ภาษาอังกฤษ" ถามกลับไปแล้วว่าอยากได้ UI ภาษาไทย หรือตัวเลือกสลับไทย/อังกฤษ **ยังไม่ได้คำตอบ**
- `TOOL_LABELS` ใน `island/hooks.ts` ยังเป็นภาษาฝรั่งเศสที่ติดมาจาก Coucou (`Exécute`, `Lit`, `Écrit` …) ต้องเปลี่ยนแน่นอน

### AGY always-proceed
- ผู้ใช้บอกว่า "แจ้งเตือนแต่ทำต่อเลย" แต่ log ทุก request รอการตัดสินใจจริง แก้กรณีหมดเวลาด้วย `force_ask` แล้ว **ถ้าผู้ใช้ยังเจออีก ให้ถามว่าเป็น tool ไหน และกดอะไร**
- เทสแล้วว่า AGY เรียก PreToolUse กับทุก tool (`view_file`, `write_to_file`, `run_command`, `ask_question`)

### ของเล็กๆ ที่ควรรู้
- unit test `agents::tests` เขียนลง log จริง (`queued a prompt for agy s1`) ไม่มีผลเสีย แต่ถ้าจะให้สะอาดควร mock log ไว้
- การ์ด approval แสดงด้วย view `approval` ส่วน view `question` (`buildQuestion`) แทบไม่ได้ใช้แล้ว ควรเช็กแล้วลบ
- `AGENT_INFO.codex` มีแล้ว แต่ยังไม่มี installer

---

## 5. สภาพแวดล้อมเครื่องตอนนี้ (สำคัญ)

- **แอปที่รันอยู่:** `windows\target\release\awuuu.exe` (build จาก `1b0b5df`) เปิดผ่าน `explorer.exe` แบบ Medium **ไม่ใช่**ตัวที่ติดตั้งใน `%LOCALAPPDATA%\Awuuu\awuuu.exe` (ตัวนั้นยังเป็น 0.2.0 เก่า)
- **hook ที่ Claude/AGY ใช้:** `%LOCALAPPDATA%\Awuuu\bin\awuuu-hook.exe` ถูก**แทนด้วยตัวใหม่แล้ว** (ตัวเก่าสำรองไว้ที่ `awuuu-hook.exe.pre-0.3.bak`)
- **Claude Code** (2.1.283) `~/.claude/settings.json` ยังเรียก hook **แบบไม่มี `--agent`** ซึ่งใช้ได้ (นับเป็น claude) แต่ติดตั้งใหม่จาก Settings ได้เพื่อให้มี flag
- **AGY** 1.2.14 ผู้ใช้ติดตั้ง hooks global (`~/.gemini/config/hooks.json`) ผ่าน Settings แล้ว (เห็นจาก event ที่ซ้ำตอนเทสใน workspace) AGY ตั้ง `toolPermission=always-proceed`
- **ไฟล์ทดสอบ AGY:** `...\scratchpad\agytest\.agents\hooks.json` (hook ระดับ workspace) **อย่าเอาไปใช้กับโปรเจกต์จริง**
- installer ล่าสุด: `windows\release\Awuuu-Windows-setup.exe` (0.2.0 + โค้ดใหม่ ยังไม่ได้ bump เวอร์ชัน)

### คำสั่งที่ใช้บ่อย
```powershell
cd C:\Users\Thanawat_OXYRON\Project\Awuuu\windows
npx tsc --noEmit
cargo test -p awuuu -p awuuu-hook
Stop-Process -Name awuuu -Force; npm run pack            # build ทั้งชุด (~4 นาที)
Copy-Item .\target\release\awuuu-hook.exe "$env:LOCALAPPDATA\Awuuu\bin\awuuu-hook.exe" -Force
explorer.exe "C:\Users\Thanawat_OXYRON\Project\Awuuu\windows\target\release\awuuu.exe"   # เปิดแบบไม่ใช่ admin
Get-Content "$env:LOCALAPPDATA\Awuuu\awuuu.log" -Tail 30
```
- เทส hook ตรงๆ: `'{"conversationId":"x","workspacePaths":["C:\\tmp"]}' | & "$env:LOCALAPPDATA\Awuuu\bin\awuuu-hook.exe" --agent agy PreInvocation` → `{}`
- เทส AGY แบบ headless: `agy -p "<prompt>"` ในโฟลเดอร์ที่มี `.agents/hooks.json` และทำ conversation เดิมต่อด้วย `agy --conversation <id> -p "<text>"`
- เทส Claude: เรียก `AskUserQuestion` ใน session ของ Claude Code แล้วให้ผู้ใช้**ตอบบนการ์ด Awuuu ภายใน 110 วินาที** (ถ้าเลยเวลา Claude จะไปถามใน terminal)

### วิธีทำงานที่ผู้ใช้ชอบ / ข้อตกลง
- ผู้ใช้พิมพ์ภาษาไทย ให้ตอบเป็นภาษาไทย
- ทำทีละ phase, 1 phase = 1 commit, verify ก่อนไปต่อ
- commit ใส่ trailer `Co-Authored-By: Claude Opus 5.5` (repo นี้ไม่มีกฎห้าม)
- ผู้ใช้ไม่ชอบรอนาน: ถ้าอะไรติดนานให้ข้ามแล้วจดไว้ (เช่นเรื่อง drop file)
- ผู้ใช้ให้ความสำคัญกับการ "ใช้ Awuuu แทนการเปิด terminal" ทุกอย่างที่ agent ถามควรตอบจากเกาะได้
- ห้ามแตะ settings หรือ hooks ของผู้ใช้โดยตรง ต้องผ่านหน้า Settings (backup + diff + ยืนยัน) ถ้าจะเทสให้ใช้ไฟล์ระดับ workspace ในโฟลเดอร์ชั่วคราว

---

## 6. ลำดับงานที่แนะนำสำหรับ session ถัดไป

1. ถามผู้ใช้เรื่อง**ภาษา**ให้ได้คำตอบก่อน และให้ผู้ใช้ดู **Agents hub ใหม่** ที่ build อยู่แล้ว
2. **ปรับขนาดเกาะเอง** (manual + ตัวเลือกขนาด) และเปลี่ยน `TOOL_LABELS` ที่ยังเป็นภาษาฝรั่งเศส (+ ทำ i18n ถ้าผู้ใช้ต้องการ)
3. **Phase 4: Hermes** (รายละเอียดในแผนเดิม):
   - shell hooks ใน `AppData\Local\hermes\config.yaml` ใช้ marker `# >>> awuuu >>>`
   - Runs API: `POST /v1/runs` + SSE `/v1/runs/{id}/events`
   - รายการ session จาก `GET /api/sessions`
   - แยกโค้ดไปไว้ใน `hermes.rs`
   - ขยาย `SENDABLE_SOURCES` และ `agents::send` ให้รองรับ hermes
4. Phase 5–8 ตามแผนเดิม และ Phase 9 (Codex) ทำท้ายสุด
5. กลับมาแก้ **drag & drop** (ข้อมูลอยู่ในหัวข้อ 4)
6. Push และออก release `0.3.0` เมื่อผู้ใช้สั่ง (ตอนนี้ยังไม่ได้ push เลย)
