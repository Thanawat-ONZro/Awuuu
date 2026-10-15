# Composio ผ่าน Hermes Agent (ตัวเลือก ปิดเป็นค่าเริ่มต้น)

## คำเตือนเรื่องความเป็นส่วนตัว (อ่านก่อนเปิด)
Composio (https://composio.dev) เป็นบริการ **cloud** ที่ถือ OAuth token ของแอปต่างๆ ของคุณ เมื่อ Hermes ใช้ Composio เนื้อหาของแอปที่เชื่อม (อีเมล ไฟล์ ปฏิทิน ฯลฯ) และ token จะผ่านและถูกเก็บที่เซิร์ฟเวอร์ของ Composio นอกเครื่องคุณ ซึ่งต่างจากหลัก "100% local / ไม่มี telemetry" ของ Awuuu ตัว Awuuu เองยังทำงานในเครื่อง แต่สวิตช์นี้เป็นจุดเดียวที่ข้อมูลออกนอกเครื่อง จึง **ปิดอยู่เสมอจนกว่าคุณจะติ๊กยอมรับ** ในหน้า Integrations → "Composio (via Hermes)"

## ข้อเท็จจริงที่ยืนยันแล้ว
Hermes (ยืนยันจากเอกสารทางการใน repo NousResearch/hermes-agent, `website/docs/user-guide/features/mcp.md`, อ่านตรงจาก raw.githubusercontent.com):
- รองรับ MCP client ในตัว ตั้งค่าที่ `~/.hermes/config.yaml` ใต้คีย์ `mcp_servers` (บน Windows Awuuu ใช้ `HERMES_HOME` หรือ `%LOCALAPPDATA%\hermes` ถ้ามี `config.yaml` ตรงนั้น ตามที่ `hooks::hermes_home()` ทำอยู่แล้ว)
- เซิร์ฟเวอร์แบบ HTTP ใช้คีย์ `url` และ `headers` (mapping)
- `${VAR}` ใน `url` และ `headers` ถูกแทนค่าตอนเชื่อมต่อ จากตัวแปรแวดล้อม ซึ่งรวมทุกอย่างใน `~/.hermes/.env` จึงไม่ต้องเขียน key ลง config.yaml
- ตั้งค่าไม่ hot-reload ในเซสชันเดิม ให้รีสตาร์ต Hermes หรือใช้ `/reload-mcp`

Composio (ยืนยันบางส่วน): เอกสาร docs.composio.dev (changelog 2025-11-13, หน้า /mcp) ระบุ URL รูปแบบ `https://backend.composio.dev/v3/mcp/<SERVER_ID>?user_id=<USER_ID>` และส่ง API key ใน header `x-api-key` ซึ่งบังคับตั้งแต่ 15 เม.ย. 2026
- แหล่งที่มา Hermes: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp และ https://github.com/NousResearch/hermes-agent (ไฟล์ docs ข้างต้น)
- แหล่งที่มา Composio: https://docs.composio.dev/mcp , https://docs.composio.dev/changelog/2025/11/13

## ส่วนที่ยังไม่ได้ยืนยัน (unverified)
- เซสชันที่เขียนเอกสารนี้เข้าถึง docs.composio.dev โดยตรงไม่ได้ (proxy บล็อก) ข้อมูลฝั่ง Composio มาจากข้อความตัดตอนของผลค้นหาหน้าทางการ ไม่ได้อ่านหน้าเต็ม Awuuu จึง **ไม่สร้าง URL เอง** ให้ผู้ใช้วาง MCP URL จาก dashboard ของ Composio เอง
- มีคู่มือบุคคลที่สามกล่าวถึง `https://connect.composio.dev/mcp` กับ header `x-consumer-api-key` ซึ่งไม่ตรงกับเอกสารทางการ ถ้า dashboard ของคุณให้รูปแบบนั้น ให้ดู header ตามที่ dashboard บอก (การ์ดใช้ `x-api-key`) แล้วแก้เองก่อนกดยืนยัน
- ยังไม่ได้ทดสอบกับ Hermes ตัวจริงบน Windows

## สิ่งที่ Awuuu เพิ่มให้
การ์ด "Composio (via Hermes)" ในหน้า Integrations (`src/app/pages/composio-card.ts`, Rust: `src-tauri/src/composio.rs`):
1. ปิดอยู่ มีคำเตือนข้างบน และต้องติ๊กยอมรับก่อนฟอร์มจะโผล่
2. แสดง YAML ที่จะเพิ่มพร้อมปุ่ม Copy:
```yaml
mcp_servers:
  composio:
    url: "<MCP URL จาก dashboard>"
    headers:
      x-api-key: "${COMPOSIO_API_KEY}"
```
3. "Add to Hermes config…" แสดง diff, ทำสำเนาสำรองลงวันที่ (`config.yaml.bak-YYYYMMDD-HHMMSS`) และเขียนหลังกดยืนยัน (ตรวจว่าไฟล์ไม่เปลี่ยนจาก preview) เขียนเฉพาะบล็อกที่มีเครื่องหมาย `# >>> awuuu-composio >>>` ถ้ามี `mcp_servers:` อยู่แล้ว Awuuu **ไม่แก้** แต่แสดงบรรทัดให้คุณวางเอง
4. API key เก็บใน Windows Credential Manager (`composio-api-key`) และไม่ส่งกลับไปที่หน้าจอ เพราะ Hermes อ่าน key จาก environment เท่านั้น ถ้าต้องการให้ใช้ได้เลย มีปุ่มแยก "Add key to Hermes .env…" (diff + สำรอง + ยืนยันเช่นกัน) ซึ่ง **จะวาง key เป็นข้อความธรรมดาใน `~/.hermes/.env`** ใครอ่านโฟลเดอร์ Hermes ได้ก็เห็น ถ้าไม่ต้องการ ให้ตั้ง `COMPOSIO_API_KEY` เป็น environment variable ของ Windows เองแทน

## การอนุมัติยังอยู่ที่ island
Awuuu แสดงการเรียก `mcp__…` ของ Hermes และขออนุมัติให้คลิกที่ island ได้อยู่แล้ว (`src/island/hooks.ts` ราวบรรทัด 163) เครื่องมือ Composio ที่ Hermes เรียกจึงยังต้องผ่านการอนุมัติของคุณตามปกติ

## วิธีปิด
- ในการ์ดกด "Turn off…" จะลบบล็อกของ Awuuu ออกจาก `config.yaml` (และ `.env` ถ้าเคยเพิ่ม) พร้อม diff, สำรอง, ยืนยัน แล้วรีสตาร์ต Hermes
- ไฟล์สำรองอยู่ข้างไฟล์เดิม ย้อนกลับได้โดยคัดลอกทับ
- ลบ key ใน Awuuu: ช่อง API key กด Save ทั้งที่ว่าง
- ยกเลิกสิทธิ์ที่ฝั่ง Composio: เพิกถอน connection และ API key ใน dashboard ของ Composio (Awuuu ลบข้อมูลที่ Composio ถือไว้ให้ไม่ได้)
