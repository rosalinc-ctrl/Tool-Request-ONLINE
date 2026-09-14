# ชุดทดสอบ (ไม่บังคับ / optional)

ทดสอบ logic ฝั่งเซิร์ฟเวอร์และตัว render ของหน้าเว็บบนเครื่องได้ **โดยไม่ต้อง deploy**
โดยจำลอง (mock) บริการของ Google Apps Script ด้วย Node.js

```bash
node tests/run.js          # ทดสอบ workflow ทั้งหมดฝั่งเซิร์ฟเวอร์ (64 เคส)
node tests/client-test.js  # ทดสอบการ render ของทั้ง 3 หน้า (26 เคส)
```

ต้องมี Node.js 18 ขึ้นไป ไม่ต้องติดตั้ง package ใดๆ

- `mock.js` — จำลอง SpreadsheetApp / DriveApp / MailApp / CacheService / LockService ฯลฯ
- `run.js` — ไล่ตั้งแต่ช่างส่งคำขอ → จัดซื้อเสนอราคา → ช่างยืนยัน/ปฏิเสธ →
  เลือกวิธีซื้อ → จัดซื้ออนุมัติ → สั่งซื้อ/ซื้อเอง → ใบเสร็จ → สรุปงานค้าง
- `client-test.js` — เอา DTO จริงจากฝั่งเซิร์ฟเวอร์มา render หน้าช่าง/หน้าจัดซื้อ/ฟอร์ม

> ใช้สำหรับตรวจ logic เท่านั้น การทดสอบจริงบนมือถือให้ทำตามขั้นตอนใน `README.md`
