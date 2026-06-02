# Honcho AI (Python SDK v2.1.1) - API Cheat Sheet

> **Language note:** explanatory prose in this file is written in **Thai**
> (ภาษาไทย). The code samples, function names, and parameters are in English
> and remain authoritative regardless of reader locale. For the English
> specification of the same SDK surface, see `platform_blueprint.md` in this
> folder. An AI that can't parse Thai should cross-reference the blueprint
> rather than skip this file — the code blocks below are the ground truth.

คู่มือสรุปคำสั่ง (Functions) หลักๆ ที่ใช้งานบ่อยในการเขียนโปรแกรมเชื่อมต่อกับ Honcho SDK แบบกระชับและเข้าใจง่าย

---

## 1. การเริ่มต้นเชื่อมต่อ (Initialization)
ตัวแปร `honcho` จะถือเป็น Client หลักในการเชื่อมต่อกับเซิร์ฟเวอร์
```python
from honcho import Honcho
import os

honcho = Honcho(
    api_key=os.environ.get("HONCHO_API_KEY"),
    workspace_id="my-app-workspace" # แยกฐานข้อมูลตามแอปพลิเคชัน
)
```

---

## 2. การสร้างตัวตน (Peer Management)
`Peer` คือผู้มีส่วนร่วมในวงสนทนา (อาจเป็น End-User, หน้าที่ของ AI, หรือผู้สังเกตการณ์) ฟังก์ชันนี้จะทำหน้าที่แบบ Get-or-Create คือถ้าไม่มีตัวตนนี้ในระบบ มันจะสร้างให้ใหม่
```python
# สร้างโพรไฟล์ตัวตน (Peer) เข้าสู่ Workspace
user = honcho.peer("user-id-1234")
ai_agent = honcho.peer("ai-therapist")

# อัปเดตข้อมูลเจาะจงที่ติดตัวผู้ใช้ (Metadata)
user.set_metadata({"role": "premium_user", "age": 28})
```

---

## 3. การจัดการห้องสนทนา (Session Management)
`Session` ทำหน้าที่ผนวกบริบทของการสนทนาว่าใครคุยกับใครในเรื่องๆ เดียวกัน
```python
# สร้าง หรือ ดึงห้องสนทนาเก่า
session = honcho.session("chat-ticket-4421")

# แอด Peer เข้าไปในห้อง ถ้าไม่แอด คนคนนั้นจะไม่มีตัวตนในวงสนทนา
session.add_peers([user, ai_agent])

# โคลนห้องแชท (เผื่อต้องการแยกสายสคริปต์การคุยเป็น 2 ทาง)
cloned_session = session.clone()
```

---

## 4. การส่งข้อความ (Messaging)
SDK v2.1.1 จะใช้รูปแบบ Builder Method โดยเอาตัวตนมาประกบข้อความ (Drafting) ก่อน แล้วค่อยกดส่งเข้า Session จริงๆ
```python
# 4.1 ร่างข้อความว่าใครเป็นคนพูด
msg1 = user.message("ฉันปวดหัวจังเลยวันนี้")
msg2 = ai_agent.message("ทานยาหรือยังเอ่ย?")

# 4.2 ยิงข้อความที่ร่างไว้เข้าสู่ระบบส่งจริง
session.add_messages([msg1, msg2])
```

---

## 5. การค้นหาข้อมูลดั้งเดิม (RAG / Semantic Search)
ไม่ต้องวุ่นวายกับการต่อ DB เอง Honcho อาศัยการเสิร์ชแบบ Vector ได้ทันทีตลอดเวลา
```python
# ค้นหาข้อความเฉพาะเรื่องที่คุยกันใน Session นี้
results = session.search(query="อาการป่วย", limit=5)

# ค้นหาข้อความแบบเจาะทะลุทั้งหมด (ทุก Session ใน Workspace)
global_results = honcho.search(query="ประวัติการรักษาทั้งหมด", limit=10)

for msg in results:
    print(msg.content)
```

---

## 6. การดึงระบบวิเคราะห์ความคิดผู้ใช้ (Representations & Dialectic Chat)
นี่คือฟังก์ชันหมัดเด็ดของ Honcho เพื่อให้ AI รู้ว่ามันควรรู้จักคนคนนั้นในมุมมองแบบไหน

```python
# 6.1 การดึงสิ่งที่ Honcho สรุปได้ว่า User คนนี้เป็นคนยังไง
user_profile = user.representation()

# 6.2 การถามคำถามใส่ "สมอง" ของผู้ใช้โดยตรง (ดึงบริบทเก่ามาวิเคราะห์)
answer = user.chat(
    query="ผู้ใช้คนนี้ชอบกินอะไรเป็นอหารเช้า?",
    reasoning_level="high" # ให้ระบบคิดวิเคราะห์ขั้นสูงก่อนตอบ
)

# 6.3 การถามแบบระบุ Perspective (เจาะลึกเฉพาะมุมที่ User มอง AI)
trust_issue = user.chat(
    query="ผู้ใช้คนนี้ไว้ใจ AI ตัวนี้มากแค่ไหน?",
    target=ai_agent,  # วิเคราะห์จากมุมมองที่ user กระทำกับ ai_agent เท่านั้น
    reasoning_level="max"
)
```

---

## 7. การกำหนดความจำฝังราก (Peer Cards)
Representation (ข้อ 6) คือสิ่งที่ระบบ "อนุมาน" ขึ้นมาเองผ่านประวัติการแชท แต่ Peer Card คือสิ่งที่เรา **"บังคับให้มันจำถาวร"**
```python
# บังคับยัดความทรงจำถาวร
user.set_card([
    "ผู้ใช้อาการแพ้ถั่วลิสงขั้นรุนแรง",
    "ห้ามเสิร์ฟอาหารรสจัดเด็ดขาด"
])

# ดึงข้อมูลถาวรออกมาดู
card_data = user.get_card()
```

---

## 8. การจัดการ Context Window แบบรวบรัด
ใช้ก่อนที่จะโยน Prompt ก้อนใหญ่ไปหา OpenAI 
```python
# ให้ Honcho ช่วยสรุปแชทยาวๆ และตัดตอนแชทไม่ให้รัน Token เกินที่กำหนด
ctx = session.context(
    tokens=1500,           # บังคับให้อยู่ใน 1500 tokens
    peer_target=user,      # โฟกัสบริบทไปที่ว่า user ต้องการอะไร
    include_most_frequent=True
)

# ข้อมูลที่ดึงได้ สามารถโยนไปให้ LLM ตัวหลักของคุณประมวลผลต่อได้เลย
print(ctx.messages) 
```

---

## 9. Advanced calls (missing from §1–8, present in the blueprint)

These three calls appear in `platform_blueprint.md` but not above. They are the
highest-value additions for any integrator who has followed §1–8 and now needs
production-grade memory consolidation.

```python
# 9.1 SessionContext — token-budgeted window ready to hand to any LLM.
ctx = session.context(
    tokens=2000,
    peer_target=user,
    include_most_frequent=True,
)
# ctx.messages is a pre-trimmed list; ctx.summary is the long-window summary.

# 9.2 Queue status — poll before issuing Dialectic queries so you reason over
# a fully consolidated state, not a half-processed one.
status = honcho.queue_status()
# status.pending_work_units == 0  → safe to query
# status.recent_failures > 0      → investigate before trusting results

# 9.3 Explicit Dream — force memory consolidation after a significant batch
# of messages, then wait for the queue to drain.
honcho.schedule_dream(session_id=session.id, mode="full")
while honcho.queue_status().pending_work_units > 0:
    time.sleep(0.5)
# Now Representations incorporate the latest Conclusions.
```

Cross-reference: Pattern 5 in `platform_blueprint.md` (“Dream Before You
Query”) explains why these three calls compose into one workflow.
