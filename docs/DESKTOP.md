# Yogurt Manager บน Mac

แอปรุ่นนี้สำหรับ Mac Apple Silicon ของเจ้าของ ใช้หน้าจอและบัญชี Yogurt เดิม โดยข้อมูลธุรกิจยังอยู่ใน Supabase การอ่านและบันทึกข้อมูลจริงต้องใช้อินเทอร์เน็ต

## ติดตั้งและเปิดใช้งาน

เปิด `Yogurt Manager-0.1.0-arm64.dmg` แล้วคัดลอก `Yogurt Manager.app` ไปยัง Applications หรือ `~/Applications` จากนั้นเปิดแอปและเพิ่มเข้า Dock ได้

แอปนี้เป็น build สำหรับใช้เอง ยังไม่ได้ notarize สำหรับแจกสาธารณะ ถ้า macOS ขอให้ยืนยันการเปิด ให้ตรวจว่าเป็นไฟล์จาก build ที่คุณไว้ใจ แล้วใช้ขั้นตอนอนุญาตแอปของ macOS ไม่ปิด Gatekeeper ทั้งระบบ

ครั้งแรก เลือกไฟล์ `.env` เดิม หรือ `.yogurt/supabase.env` ที่เก็บการเชื่อมต่อ Supabase ของคุณ แอปนำเข้าเฉพาะ DATABASE_URL และเก็บการตั้งค่าแบบเข้ารหัสด้วย Keychain สร้าง session secret สำหรับแอปเอง ไม่ต้องใส่รหัสฐานข้อมูลลง GitHub หรือตัวติดตั้ง อาจมีคำถามจาก Keychain เมื่อเปลี่ยน build/signature

ใบเสร็จเดิมใน `.yogurt/private-receipts` และ `public/uploads/receipts` ของโปรเจกต์เดียวกับไฟล์ตั้งค่าจะถูกคัดลอกและตรวจ checksum ก่อนจบการนำเข้า ต้นฉบับยังอยู่ หากการนำเข้าถูกขัดจังหวะ ให้เลือกไฟล์เดิมอีกครั้ง ระบบข้ามไฟล์ที่ตรงกันและหยุดเมื่อพบไฟล์ขัดแย้ง

เข้าสู่ระบบด้วยบัญชี Yogurt เดิม แอปไม่ seed, reset, คัดลอก หรือ migrate ฐานข้อมูลจริงตอนเปิดใช้งาน

## เปิด–ปิดและข้อมูลค้าง

- เปิดแอปจึงเริ่มส่วนประมวลผลเฉพาะเครื่อง ปิดหน้าต่างสุดท้ายหรือ Cmd-Q แล้วแอปและ backend หยุดด้วย
- ไม่เปิดตอน login, ไม่ติดตั้ง LaunchAgent, ไม่เปิด Cloudflare tunnel และไม่เรียกบริการเว็บไซต์เก่ากลับมา
- เปิดแอปซ้ำจะกลับไปหน้าต่างเดิม พอร์ตภายในคงที่ `127.0.0.1:43187` เพื่อรักษา cookies และข้อมูลร่าง หากพอร์ตถูกใช้โดยโปรแกรมอื่น แอปจะแจ้งปัญหาและหยุด ไม่ยึด process อื่น
- Browser ปกติเปิด URL ภายในแทนตัวแอปไม่ได้ เพราะ backend ตรวจ capability ของแอปทุกคำขอ
- หากรายการเงินยังไม่ทราบผล ให้เปิดแอปใหม่และกู้คืน/ตรวจรายการเดิมก่อนสร้างรายการใหม่ พฤติกรรมป้องกันรายการซ้ำยังใช้ key และเนื้อหาเดิม
- เมื่อ Supabase ติดต่อไม่ได้ การแสดงผลเดิมอาจเป็นโหมดอ่านอย่างเดียว/ข้อมูลตัวอย่างที่มีป้ายกำกับ อย่าถือว่าเป็นยอดจริงล่าสุด และไม่ถือว่ารายการบันทึกสำเร็จจนได้รับผลยืนยัน

## ตำแหน่งข้อมูลส่วนตัวและการอัปเดต

ค่าปกติอยู่ที่ `~/Library/Application Support/Yogurt Manager`:

| ตำแหน่ง | สิ่งที่เก็บ |
| --- | --- |
| `desktop-config.enc` | การเชื่อมต่อ Supabase และ session secret ที่เข้ารหัส |
| `runtime/private-receipts` | ใบเสร็จส่วนตัว |
| `runtime/metrics` | บันทึกประสิทธิภาพ |
| `runtime/backups` | backup และหลักฐานตรวจ restore ที่คุณสั่งเอง |
| Browser session storage | cookies, drafts และคำขอที่ยังไม่ยืนยันผล |

อัปเดตโดยปิดแอปแล้วแทนที่ไฟล์ `.app` ด้วย build ใหม่ ไม่ลบโฟลเดอร์ Application Support การคัดลอก `.app` ไปอีกเครื่องไม่ได้คัดลอก Keychain, credentials, ใบเสร็จ หรือ drafts ให้ด้วย

รูปแบบเชื่อม PostgreSQL ตรงนี้เหมาะกับเครื่องเจ้าของที่ไว้ใจได้ ผู้ควบคุมเครื่องสามารถเข้าถึง credentials ของโปรแกรมได้ อย่าแจกไฟล์ตั้งค่าฐานข้อมูลนี้ให้พนักงานหรือเครื่องที่ไม่ไว้ใจ การขยายไปเครื่องพนักงานต้องออกแบบขอบเขต backend/สิทธิ์เพิ่มเติม

## สำรองข้อมูลด้วยตนเอง

ข้อมูลธุรกิจใน Supabase กับใบเสร็จบน Mac เป็นคนละส่วน ต้องสำรองทั้งสองส่วน การเปิดแอปไม่ได้เปิดตาราง backup เดิมกลับมา หน้า operations จะแจ้ง missing/stale/unverified ตามหลักฐานจริง

ปิดแอปก่อนสำรองหรือ restore แล้วใช้เครื่องมือเดิมจาก source checkout ที่มี private `.env` ถูกต้อง:

```sh
YOGURT_DATA_ROOT="$HOME/Library/Application Support/Yogurt Manager/runtime" npm run db:backup:dump
```

คำสั่งนี้อ่านฐานข้อมูลที่ตั้งใน `.env` และเก็บ dump/checksum/metadata พร้อมใบเสร็จจาก data root ของแอป ตรวจให้เป็น Supabase โครงการเดียวกับที่นำเข้าในแอป อย่าใช้ไฟล์ตั้งค่าจากโครงการอื่น

การตรวจ restore ยังใช้ PostgreSQL tools และ scratch database บน Mac ที่เตรียมไว้โดยเจตนา ไม่ใช่ dependency สำหรับเปิดแอปประจำวัน และบริการ maintenance PostgreSQL เดิมยังหยุดอยู่ เมื่อมีสภาพแวดล้อมตรวจ restore พร้อมแล้ว ใช้ data-root เดียวกันกับ `npm run db:verify-backup` หรือ `npm run db:dr-drill` ดู [runbook](OPERATIONS.md) สำหรับเงื่อนไขและขอบเขตการตรวจ อย่าถือว่า dump สำเร็จเท่ากับทดสอบกู้คืนสำเร็จ

## Build และตรวจแอปจากซอร์ส

```sh
npm ci
npm run desktop:package
npm run desktop:verify
```

`desktop:package` build ในโฟลเดอร์ชั่วคราวที่คัดเฉพาะซอร์สและใช้ placeholder credentials จึงไม่โหลด `.env` จริง จากนั้นบรรจุ Next.js, assets, Prisma engine และ Electron ไว้ครบ การใช้งานแอปที่ติดตั้งไม่ต้องมี Node/npm/Homebrew แยก

ตัวแอปอยู่ใน `dist-desktop/mac-arm64/Yogurt Manager.app` และตัวติดตั้งใน `dist-desktop/Yogurt Manager-0.1.0-arm64.dmg` ทั้งสองเป็น build artifacts ที่ถูก ignore ไม่รวม credentials หรือไฟล์ส่วนตัว

`desktop:verify` ใช้ Playwright เปิดสำเนาแอปนอก repository ใน path ที่มีช่องว่าง สร้าง PostgreSQL cluster ชั่วคราวและข้อมูลสังเคราะห์ แล้วเก็บภาพ/ผลตรวจใน `docs/verification/desktop-2026-10-29` เครื่องมือ PostgreSQL เป็น dependency ของการทดสอบเท่านั้น ปรับ `DESKTOP_TEST_PG_BIN` หากตำแหน่งต่างจากค่า Homebrew ปกติ Cluster, profile ทดสอบและแอปทดสอบถูกล้างหลังตรวจ ไม่เพิ่มรายการทดลองใน Supabase จริง

ห้ามใช้ `--yogurt-test` สำหรับงานจริง โหมดนี้ยอมรับเฉพาะฐานข้อมูล loopback ชื่อ `yogurt_e2e_*` และต้องใช้ profile แยกใต้โฟลเดอร์ temp ของระบบ การเปิดแอปปกติยอมรับ Supabase ที่เชื่อมผ่าน TLS เท่านั้น
