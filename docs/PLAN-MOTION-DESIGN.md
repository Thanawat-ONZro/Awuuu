# แผน: Motion, ดีไซน์ของ Awuuu เอง และ feature ที่ยังขาด (เทียบ coucou)

สถานะ: **ร่างให้ Owen ตรวจ ยังไม่แก้โค้ดใดๆ** · ฐาน: main `cbcffba` (v0.8.0) · อ่าน coucou `Louis-CFM/coucou` (MIT) ณ 15 ต.ค. 2026

## 0. ข้อควรรู้ก่อนอ่าน
- **ไม่มี REA MCP (reverse engineering anything) ใน session นี้** จึงอ่านโค้ด coucou ตรงๆ แทน (clone แล้วเทียบกับ Awuuu ไฟล์ต่อไฟล์) ถ้า Owen ต่อ REA MCP ภายหลัง งาน M/D ด้านล่างไม่ต้องแก้แผน
- **Haiku รุ่นล่าสุดคือ 4.5 ไม่มี 5.5** แผนนี้จึงกำหนด Haiku 4.5 สำหรับงานง่าย (Sonnet 5.5 / Opus 5.5 ตามที่ Owen สั่ง)
- coucou เป็น MIT ดัดแปลงได้โดยคง notice; vorssaint-utils เป็น GPL ห้ามคัดลอก
- ไม่ใช้ GitHub Actions: ทุก task ตรวจด้วย `bash windows/scripts/check-cloud.sh` (tsc, cargo check, test) ส่วน motion/สี **ดูด้วยตาจริงต้อง Owen ทดสอบบน Windows** (cloud เห็นภาพ webview ของ Tauri ไม่ได้)
- Claude ไม่ merge ไม่ออก release เอง

## 1. สิ่งที่พบจากโค้ดจริง
**Motion ตอนนี้**
- `windows/src/core/anim.ts` เหมือน coucou ทุกบรรทัด (Spring แบบ SwiftUI, Ease, cubicBezier) สปริงใช้กับ**ขนาด/มุมของ island** (`island.ts:744`) แต่ไม่ได้ใช้กับเนื้อหาข้างใน
- สลับแท็บ (`style.css:436`): `.view` แค่ crossfade + scale 0.97→1 หน่วง 0.16 วิ ไม่มีทิศทาง ไม่รู้ว่าไปแท็บไหน และ **ไฮไลต์แท็บ (`.tab.on`) กระโดดทันที** ไม่เลื่อน
- coucou ก็ทำแบบเดียวกันทุกอย่าง (`.view`, `.tab.on`) **จึงไม่มีอะไรให้ลอกเรื่องสลับแท็บ ต้องออกแบบเอง** (ข้อดี: จะเป็นเอกลักษณ์จริง)
- หน้าต่าง Settings (`app/shell.ts:127`): `clear(content); content.append(el)` ไม่มี transition เลย
- มี `prefers-reduced-motion` แค่ที่ glow (`style.css:2063`) และ `island.ts:54` ส่วน `.view` ไม่เคารพ
- ของดีที่มีแล้ว: glow รอ/เสร็จ/พัง, แผ่นดิสก์ shimmer, สุนัขวาดด้วย Canvas

**สี/ดีไซน์ตอนนี้**
- ตัวแปรใน `style.css:7-31` เป็นสีน้ำตาลอุ่น + caramel `#e4a871` เป็นจุดเด่นอยู่แล้ว แต่สีสถานะ (`--red/--green/--amber/--cyan/--indigo/--pink`) เป็นค่า Tailwind ทั่วไป และ glow (`style.css:2067-2078`) ฝังเลข rgba เอง จึงดู "ธีมดำ + ส้ม" เหมือน coucou (`#fb923c`) มากกว่าเป็นของ Awuuu
- Settings window (`appearance.css`, `app.css`) ฝังสี `rgba(228,168,113,…)` ตรงๆ หลายที่ ไม่ผ่านตัวแปร

## 2. ระบบ Motion ใหม่: "Paw Motion"
หลักการ: **ทุกอย่างขยับแบบสปริงมีน้ำหนัก (ตัวเบา กระดอนนิด) และสุนัขมีส่วนร่วม** เฉพาะ `transform`/`opacity` ไม่ animate layout, 0% CPU ตอนซ่อน

| ชิ้น | ทำอย่างไร |
|---|---|
| **โทเคน motion** | ไฟล์ `windows/src/core/motion.css` ตัวแปร `--m-fast: 140ms`, `--m-base: 260ms`, `--m-slow: 420ms`, `--m-spring` (ใช้ CSS `linear()` ประมาณสปริงกระดอนเล็กน้อย), `--m-out: cubic-bezier(.2,.8,.2,1)`, `--m-in: cubic-bezier(.4,0,1,1)` และค่า TS คู่กันใน `anim.ts` (response/damping ตัวเดียวกัน) |
| **ตัวเลื่อนไฮไลต์แท็บ** | แทน `.tab.on` ที่กระโดด ด้วยแคปซูลเดียว (`.tab-thumb`) เลื่อนด้วย `translateX` + ยืดตามความกว้างปลายทาง (สปริง ~260ms) ตอนเปลี่ยนแท็บแคปซูล "ยืด" ไปหาแท็บใหม่แล้วหดตาม |
| **สลับ view แบบมีทิศทาง** | เรียงแท็บ agents → chat → home → drop; ไปทางขวา view เก่าเลื่อนออกซ้าย 14px + จาง, view ใหม่เข้ามาจากขวา 14px; ทางซ้ายกลับกัน; view แบบ alert (approval, note) ขึ้นจากล่างแทน; ความสูง island ที่สปริงอยู่แล้ว (`animateGeometry`) ทำงานคู่กัน ไม่รอกัน |
| **เนื้อหา stagger** | การ์ดแถวใน view ใหม่เข้าไล่ทีละ 24ms (สูงสุด 6 ชิ้น) เพื่อให้ "ไหล" ไม่ใช่ "โผล่" |
| **สุนัขตอบรับ** | เปลี่ยนแท็บ: สุนัขหันตาไปทางที่เลื่อน + หางกระดิก 1 ครั้ง (ใช้ emote ที่ engine มี); approval ขึ้น: หูตั้ง; เสร็จ: กระโดดเบาๆ (ต่อเข้ากับ `glow-done`) ไม่เพิ่ม loop ใหม่ ใช้ frame loop เดิมของ engine |
| **Settings window** | เปลี่ยนหน้าด้วย fade + เลื่อนขึ้น 8px (หน้าเก่าไม่ต้องรอ ไม่บล็อกการ navigate เหมือนเดิม) และ sidebar มีตัวเลื่อนไฮไลต์แบบเดียวกับแท็บ |
| **กฎ** | `prefers-reduced-motion: reduce` → ตัดเหลือ fade 120ms ไม่มีเลื่อน/กระดอน/สุนัขขยับเกินจำเป็น; ปิด animation เมื่อ `visibilityState != visible` |

## 3. ชุดสี/ดีไซน์โทเคนของ Awuuu: "Shiba Warm"
ที่มาของสี: ตัวสุนัขเอง (ครีม, caramel, จมูกดำ, ลิ้นชมพู) ไม่ใช่สีแอปทั่วไป ใช้ชื่อโทเคนเป็นชื่อของสุนัข ฝังเลขสีในโค้ดอื่นห้ามเหลือ

| โทเคน | ค่าเสนอ | ใช้กับ |
|---|---|---|
| `--bg-nose` | `#0b0908` | พื้น island (ดำอุ่น ไม่ใช่ดำล้วน) |
| `--bg-kibble` | `#1a1612` (เดิม `--card`) | การ์ด |
| `--bg-biscuit` | `#241e19` (เดิม `--tab-on`) | แท็บ/ปุ่มที่เลือก |
| `--ink-cream` | `#fff4e6` | ตัวหนังสือหลัก (คงเดิม) |
| `--accent-caramel` | `#e4a871` | ปุ่มหลัก/โฟกัส (คงเดิม เป็นลายเซ็น) |
| `--state-wait` (ขนมรอ) | `#f2b04c` | รอคำตอบ (amber อุ่นขึ้น) |
| `--state-done` (หญ้า) | `#6fcf97` | เสร็จ (เขียวอ่อนอมเหลือง ไม่ใช่ `#22c55e`) |
| `--state-error` (จมูกแดง) | `#ef6f5e` | พัง |
| `--state-info` (ลิ้นชมพู) | `#f29db0` | ข้อมูล/แชท Awuuu |
| `--state-agent` (ฟ้าท้องฟ้า) | `#7fb6d9` | agent ภายนอก (แทน indigo/cyan) |

เพิ่มเอกลักษณ์ 3 อย่าง:
1. **ขอบเรืองสถานะผูกกับโทเคน** (แทนเลข rgba ใน `style.css:2067`) และ glow สุนัข "หายใจ" ช้า 4 วิ ตอน idle (เฉพาะตอนมองเห็น)
2. **แถบสีหน้า (page hero band) ของ Settings**: แถบบางด้านบนทุกหน้า ไล่สีโทเคนของหน้านั้นพร้อมอนุภาคเล็กจางๆ (ไอเดียจาก `hub/hero.ts` ของ coucou เขียนใหม่ ใช้ canvas เดียว หยุดเมื่อซ่อน)
3. **ตัวเลือกธีมสีตามพันธุ์สุนัข**: Appearance มีสุนัขหลายพันธุ์อยู่แล้ว ให้ accent ตามขนสุนัขที่เลือก (ค่าเริ่มต้น Shiba = caramel) ทำให้แอปเป็นของ "เจ้าของคนนี้" จริง ตรวจ contrast ตัวหนังสือบน accent ≥ 4.5:1 ทุกพันธุ์

## 4. Feature ที่ Awuuu ยังไม่มี/ยังไม่ดี (เทียบ coucou)
เรียงตามลำดับของ Owen: AI → เสถียร/UX → integration → เสริม (ทำไปแล้วไม่ต้องทำ: เตือน, doctor, handoff, story, quiet hours, ตรวจเทสต์)

| # | ช่องว่าง | coucou มี | Awuuu ตอนนี้ | คุ้มไหม |
|---|---|---|---|---|
| F1 | **ปรับ shortcut เองได้** | `core/shortcuts.ts` + `shortcuts.rs`, หน้า Settings → Shortcuts | `hotkeys.rs` ตายตัว (Ctrl+Alt+Y/N) | สูง งานกลาง |
| F2 | **สลับโมเดลแชทจากหัวแชท** | คลิกชื่อโมเดลเหนือช่องแชทเพื่อเปลี่ยน provider | มี provider แต่ต้องไปตั้งในหน้า Chat (ตรวจ `views/chat.ts` ก่อน) | สูง งานเล็ก |
| F3 | **อนุมัติ + ถามกลับ (AskUserQuestion) ครบ** | ตัวเลือก 1-4 คำถาม single/multi บน island | `hooks.ts` อ่าน AskUserQuestion แล้ว แต่ต้องตรวจว่า UI รองรับ multi-select และ "Always" ครบ | กลาง ตรวจก่อน |
| F4 | **ดู diff เต็มจาก ticker** | แตะไฟล์ใน ticker อ่าน diff | มี diff ใน handoff/sessions แต่ไม่มีบน island | กลาง |
| F5 | **ภาษา TH/EN (+10 ภาษาของ coucou)** | `i18n/` ไฟล์ JSON 10 ภาษา (MIT) | ไม่มี (roadmap 8.5 ถูกเลื่อน) | สูงสำหรับผู้ใช้ไทย งานกลาง |
| F6 | **ชุดแต่งตัวน้องหมา + ตามฤดูกาล** | `mochi/outfits.ts` 1.1k บรรทัด, auto ตามฤดู | มีพันธุ์/สี/ปลอกคอ ไม่มีเครื่องแต่งกาย | ต่ำ-กลาง น่ารัก |
| F7 | **เสียงของตัวเอง (โฟลเดอร์ sounds)** | วางไฟล์ชื่อเดียวกับเสียงเพื่อแทน | มีสวิตช์เสียง ไม่มีโฟลเดอร์แทนเสียง | ต่ำ งานเล็ก |
| F8 | **Weekly recap** | สรุปรายสัปดาห์ แชร์เป็นภาพ | `extras.rs`/`recap.ts` มีบางส่วน (ตรวจ) | ต่ำ-กลาง |
| F9 | **น้องหมาออกมาอยู่บน desktop** | ลากออกจาก island เป็นเพื่อน 120pt | ไม่มี | กลาง-สูง งานใหญ่ (Win32) |
| F10 | **สั่งด้วยเสียง/dictate ในแชท** | Flow dictation (Mac เป็นหลัก) | ไม่มี | ต่ำ งานใหญ่มาก ยังไม่แนะนำ |
| F11 | **Phone link (iOS/Android)** | มีทั้งชุด + relay | ไม่มี | ต่ำ งานใหญ่มาก ไม่แนะนำรอบนี้ |
| F12 | Spotify/Apple Music pill, Portfolio pill, Notetaker | มี (ส่วนใหญ่ Mac) | ไม่มี | ไม่แนะนำ ไม่เกี่ยวกับเป้าหมาย "ผู้ช่วยใช้งานได้จริง" |

ข้อสังเกตเรื่อง "friendly + ใช้งานได้จริง" ที่ coucou ไม่มีแต่ Awuuu ควรเหนือกว่า: ข้อความของน้องหมาเป็นภาษาไทยธรรมชาติ, สรุปงาน agent เป็นภาษาคน (story engine มีแล้ว), คำแนะนำเมื่อระบบพัง (`aw doctor` มีแล้ว) — งานรอบนี้จึงเน้น motion/สี (ส่วนที่ Owen ขอ) แล้วค่อย F1, F2, F5

## 4b. Feature เพิ่มเติมของ coucou ที่แผนข้อ 4 ยังไม่ได้ลง (อ่านจาก README/windows ของ coucou)
| # | Feature | หมายเหตุ | คุ้มไหม |
|---|---|---|---|
| G1 | Hotkey ทั่วเครื่อง: เปิดแชท (Ctrl+Alt+Space), ไปที่คำขออนุมัติ, เปิดเทอร์มินัลของ session, mute, เปิด/ปิด island | Awuuu มีแค่ Ctrl+Alt+Y/N รวมเข้า F1 | สูง |
| G2 | Hotkey ใน island: Ctrl+1-9 สลับ pill, Ctrl+Enter ส่ง, Ctrl+K แชทใหม่, Ctrl+E เปิด diff | รวมเข้า F1/F4 | กลาง |
| G3 | Open on hover: วางเมาส์บน island แล้วเปิดเอง พับเองเมื่อเมาส์ออก | งานเล็ก ควรทำ | สูง |
| G4 | เลือกจอที่น้องหมาอยู่ / ตามจอที่ใช้อยู่ | Awuuu จัดการ multi-monitor แล้วแต่ไม่มีตัวเลือก | กลาง |
| G5 | เมนู tray: Weekly recap, Wardrobe | Awuuu tray มี Pause/Update/Reset แล้ว | ต่ำ |
| G6 | สีต่อ pill/น้องหมาแต่ละตัว (palette คลิกที่จุดสี) | Awuuu มี look ต่อ agent แล้ว แต่ยังเลือกเองไม่ได้ | กลาง |
| G7 | Agent เพิ่ม: Codex, Copilot CLI, Muse, OpenCode, Amp, Antigravity, Cursor, Gemini ติดตั้ง hook ให้ในหน้า Settings | Awuuu มี payload ทั่วไปแล้ว แต่ยังไม่มีปุ่มติดตั้งอัตโนมัติ (roadmap 7.3 ที่เลื่อนไว้) | สูง |
| G8 | Claude Desktop / Hermes plugin ติดตั้งผ่านปลั๊กอินของ agent เอง | Awuuu ต่อ Hermes ผ่าน API ตรงแล้ว | ต่ำ |
| G9 | Plan usage ของ Codex | Awuuu มีของ Claude/Codex บางส่วนใน `usage.rs` (ตรวจ) | กลาง |
| G10 | GitHub: PR ของฉัน, รอรีวิว, CI ของ default branch | Awuuu มีใน integrations แล้ว | มีแล้ว |
| G11 | Flow dictation (กดค้างแล้วพูดวางที่ cursor), Pill ล่างจอ, Notetaker อัดประชุม, "OK Coucou" สั่งเสียงแบบ Jarvis | ใช้ Parakeet/WASAPI ใหญ่ ไม่ใช่แกนของ Awuuu | ต่ำ ไม่แนะนำ |
| G12 | Relay/Phone link, Android app, Live Activity | ใหญ่มาก | ไม่แนะนำ |
| G13 | Wardrobe ตามฤดูกาล (หมวกแม่มดเดือนตุลา ฯลฯ) | = F6 | ต่ำ-กลาง |

ที่ผมแนะนำเพิ่มเข้าเฟส B: **G3 (Haiku 4.5, $0.5-1)** และ **G7 ปุ่มติดตั้ง hook ต่อ agent (Sonnet 5.5, $4-6)** ส่วน G1/G2/G4/G6 ผูกกับ F1 หรือทำต่อท้าย

## 4c. การต่อแอปอื่น / Composio
ของที่ Awuuu ต่อเองอยู่แล้ว (ทำงานในเครื่อง key อยู่ใน Credential Manager): Gmail/Outlook/IMAP, ปฏิทิน (Google/Microsoft/iCal), RSS, uptime, อากาศ, Todoist, GitHub, Stripe, Vercel, n8n, Resend, Notion, Cal.com

**Composio**: บริการ cloud ที่ถือ OAuth ของแอปนับพัน (ฟรี 20K calls/เดือน, $29 = 200K ตามหน้า pricing ของเขา; ตัวเลขจากเว็บเปรียบเทียบไม่ตรงกัน ต้องเช็กหน้าทางการก่อนใช้จริง)
- ข้อขัดกับกฎของ Awuuu: ทุกการเรียกและ token ของแอปผู้ใช้ผ่านเซิร์ฟเวอร์ Composio ซึ่งขัดกับ "No telemetry / 100% local / เรียกเฉพาะบริการที่ผู้ใช้ตั้งเอง" ใน CLAUDE.md จึง**ไม่ฝังใน Awuuu เป็นค่าเริ่มต้น**
- ทางที่ลงตัว: ใส่ Composio เป็น MCP server ให้ **Hermes Agent** (ฝั่ง agent ไม่ใช่ฝั่ง Awuuu; ต้องยืนยันว่า Hermes รุ่นที่ Owen ใช้รองรับ MCP) Awuuu เห็นการเรียก `mcp__…` และขออนุมัติให้คลิกได้อยู่แล้ว (`island/hooks.ts:163`) จึงได้ "ผู้ช่วยทำงานข้ามแอปได้" โดย Awuuu ยังเป็นเครื่องมือในเครื่อง
- ถ้าจะให้ Awuuu ตั้งค่าให้: ทำเป็นปุ่ม opt-in ในหน้า Integrations "เปิด Composio ผ่าน Hermes" พร้อมคำเตือนว่าข้อมูลผ่านบริการภายนอก (Task X1, Sonnet 5.5, $2-4, หลัง Owen ยืนยันว่า Hermes รองรับ MCP)

**ต่อเองเพิ่ม (ตรงเป้า "ใช้งานได้จริง")**: ร่างตอบอีเมลจากแชท/Quick actions (ส่งออกต้องคลิกยืนยันเสมอ, roadmap 8.2), Linear, Slack/Discord แจ้งเตือนอย่างเดียว, Google Drive/Sheets อ่านอย่างเดียว (ตัวละ Sonnet 5.5 $3-5)

## 5. แตก task + worker + ค่าใช้จ่าย
กติกา worker ตามที่ Owen สั่ง: ค่าเริ่มต้น **Sonnet 5.5 medium**; งานง่ายทำตามแผนได้เลย **Haiku (4.5)**; บั๊กหนัก/feature ใหญ่มาก **Opus 5.5 medium**
ค่าใช้จ่ายเป็น**การประเมิน ไม่ใช่ค่าที่วัดจริง** (เทียบ PR ขนาดกลางใน ROADMAP ที่ $2-5; Haiku ถูกกว่าราว 3-4 เท่า, Opus แพงกว่าราว 1.5-2 เท่า)

### เฟส A — Motion + ดีไซน์ (ที่ Owen ขอก่อน) เป้าหมายรวม ≈ $9-15
| Task | งาน | Worker | ประเมิน | เกณฑ์ผ่าน |
|---|---|---|---|---|
| D1 | `tokens.css`: โทเคนสี Shiba Warm + แทนตัวแปรเดิมโดยชื่อเก่ายังใช้ได้ (alias) | Sonnet 5.5 | $2-3 | `check-cloud.sh` ผ่าน, ไม่มีเลข hex ใหม่นอก tokens |
| D2 | ไล่แทนเลข rgba/hex ที่ฝังใน `style.css`, `app/*.css` เป็นโทเคน (กลไก ตามรายการจาก D1) | Haiku 4.5 | $0.5-1 | grep ไม่พบ `228, 168, 113` นอก tokens |
| M1 | `motion.css` + ค่าคู่ใน `anim.ts` + ตัวเลื่อนไฮไลต์แท็บ | Sonnet 5.5 | $2-3 | tsc ผ่าน, vitest ครอบตัวคำนวณตำแหน่งแท็บ |
| M2 | สลับ view มีทิศทาง + stagger + ทำงานคู่ `animateGeometry` | Sonnet 5.5 | $3-5 | vitest ครอบการเลือกทิศทาง; Owen ดูบนเครื่อง |
| M3 | สุนัขตอบรับ (หัน/หางกระดิก/หูตั้ง/กระโดด) ผูกกับ M2 และ glow | Sonnet 5.5 | $2-3 | ไม่เพิ่ม loop ใหม่; Owen ตรวจ CPU idle |
| M4 | Settings window: transition หน้า + ตัวเลื่อนไฮไลต์ sidebar | Haiku 4.5 | $0.5-1 | ใช้คลาสจาก M1 เท่านั้น |
| M5 | reduced-motion + หยุดเมื่อซ่อน ทั่วทั้งแอป และ test | Haiku 4.5 | $0.5-1 | media query ครอบทุก transition ใหม่ |
| D3 | hero band + อนุภาค (canvas เดียว หยุดเมื่อซ่อน) | Sonnet 5.5 | $2-4 | 0% CPU เมื่อหน้าต่างซ่อน |
| D4 | accent ตามพันธุ์สุนัข + ตรวจ contrast ทุกพันธุ์ (สคริปต์) | Sonnet 5.5 | $1.5-2.5 | สคริปต์ contrast ≥ 4.5:1 ผ่านหมด |

ลำดับ: D1 → D2 → M1 → M2 → M3 → M4 → M5 → D3 → D4 (PR ละ task, ต่อกันเป็นสาย เหมือนเวอร์ชันก่อน) แนะนำเปิดทีเดียว **D1-M2 ก่อน** แล้วให้ Owen ดูบนเครื่องจริงว่า feel ถูกใจก่อนทำ M3 เป็นต้นไป

### เฟส B — Feature (หลัง Owen ดู A แล้ว) เป้าหมายรวม ≈ $12-25
| Task | งาน | Worker | ประเมิน |
|---|---|---|---|
| F2 | สลับโมเดลจากหัวแชท | Haiku 4.5 (ถ้าแค่ต่อ UI กับ provider ที่มี; ถ้าต้องแก้ `claude.rs` เปลี่ยนเป็น Sonnet) | $0.5-1 |
| F7 | โฟลเดอร์เสียงของตัวเอง | Haiku 4.5 | $0.5-1 |
| F1 | Shortcuts ปรับเองได้ (Rust + หน้า Settings) | Sonnet 5.5 | $3-5 |
| F5 | i18n TH/EN ก่อน (ดึงโครงจาก coucou) แล้วค่อยเพิ่มภาษา | Sonnet 5.5 | $4-6 (+$1/ภาษาแบบ Haiku แปล) |
| F3 | ตรวจ/เติม AskUserQuestion multi-select + Always | Sonnet 5.5 | $2-3 |
| F4 | ดู diff จาก ticker | Sonnet 5.5 | $2-4 |
| F6 | เครื่องแต่งกาย + ตามฤดู | Sonnet 5.5 | $3-5 |
| F8 | Weekly recap แชร์ภาพ | Sonnet 5.5 | $2-4 |
| F9 | น้องหมาออกมาบน desktop (Win32 window + physics + บิน กลับ island) | **Opus 5.5 medium** | $6-10 |
| F10, F11 | dictate / phone link | Opus 5.5 medium **ไม่แนะนำรอบนี้** | $15+ แต่ละอัน |

บั๊กหนักที่โผล่ระหว่างทางเช่น แย่ง focus, CPU ไม่ลดตอนซ่อน, สปริงค้าง → ส่งต่อ Opus 5.5 medium เฉพาะเคสนั้น

## 6. งบรวมและความเสี่ยง
- เฟส A ≈ **$9-15**, เฟส B ถ้าทำ F1-F8 ≈ **$12-25**, F9 เพิ่ม $6-10 → ทั้งหมดอยู่ราว **$27-50** (ประเมิน) ควรทำเฟส A + F2, F7, F1, F5 ก่อน (≈ $20-32) แล้วตัดสินใจต่อ
- งบ cloud รอบก่อน ($50) ใช้ไปเกือบหมดแล้ว ดังนั้นต้องยืนยันงบรอบใหม่กับ Owen ก่อนเริ่ม และรายงานค่าใช้จ่ายจริงเมื่อจบแต่ละ PR
- ความเสี่ยงหลัก: motion ตรวจ feel จาก cloud ไม่ได้ → จึงแบ่ง PR เล็กและให้ Owen ดูบนเครื่องหลัง M2; การแตะ `island.ts` (1.4k บรรทัด) ที่แก้ยาก ให้ M2 ทำเป็นไฟล์ใหม่ `island/transition.ts` แล้วต่อเข้าแค่จุดเดียว

## 7. สิ่งที่ต้องการให้ Owen ตัดสินใจ
1. ชุดสี Shiba Warm ตามตารางข้อ 3 โอเคไหม หรืออยากให้เน้นโทนอื่น (เช่น เย็นขึ้น)
2. เริ่มเฟส A (D1-M2 ก่อน) ได้เลยไหม และยืนยันงบรอบใหม่
3. Haiku 4.5 แทน "Haiku 5.5" ตามที่ไม่มีรุ่น 5.5 ใช่ไหม
4. เฟส B เลือก feature ไหนก่อน (แนะนำ F2, F7, F1, F5)
