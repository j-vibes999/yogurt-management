# Yogurt Manager — แอปติดตั้งบน Mac + Supabase

สถานะ: เจ้าของยืนยันให้ดำเนินการวันที่ 29 ตุลาคม 2026; เริ่มพัฒนาตามแบบนี้

## เป้าหมายและขอบเขต

ทำระบบ Yogurt เดิมเป็นแอปที่เปิดจาก Applications/Dock บน Mac เครื่องนี้ โดยใช้ข้อมูลและบัญชีผู้ใช้ใน Supabase เดิม ส่วนประมวลผลในเครื่องเริ่มพร้อมแอปและหยุดเมื่อปิดแอป ไม่ต้องเปิด Terminal หรือสั่ง npm เพื่อใช้งานประจำวัน

เป้าหมายรุ่นแรกคือ Mac ของเจ้าของที่ตรวจพบว่าเป็น Apple Silicon (arm64) ไม่ใช่รุ่นแจกพนักงานหรือ Windows การอ่านและบันทึกข้อมูลจริงใน Supabase ต้องใช้อินเทอร์เน็ต ไม่เพิ่มฐานข้อมูลสำรองแบบ offline หรือระบบ sync ใหม่

คงหน้าจอภาษาลาว สี หมวดงาน บัญชี สิทธิ์ การคำนวณสต็อก/เงิน และพฤติกรรมป้องกันรายการซ้ำที่มีอยู่เดิม GitHub เก็บซอร์สโค้ดและคำแนะนำการ build; ข้อมูลจริงและรหัสเชื่อมต่อไม่อยู่ใน GitHub หรือตัวติดตั้ง

## ทางเลือกและข้อเสนอ

1. **แนะนำ: Electron + Next.js/Node ที่บรรจุมากับแอป** — ใช้ระบบเว็บและ Prisma เดิม พร้อม Chromium สำหรับหน้าจอ เหมาะกับการรักษาพฤติกรรมที่ทดสอบไว้แล้ว แลกกับขนาดแอปที่มากกว่า native shell
2. **Swift/WKWebView** — ตัวครอบหน้าจอเล็กกว่า แต่ยังต้องบรรจุและจัดการ Node backend เช่นเดิม และต้องตรวจพฤติกรรม WebKit, cookies, browser storage และ native bridge เพิ่ม
3. **เขียนระบบใหม่เป็น native หรือเปลี่ยนเป็น Supabase client โดยตรง** — เปลี่ยนขอบเขตการยืนยันตัวตนและสิทธิ์ฐานข้อมูลมากเกินความจำเป็นสำหรับการติดตั้งบนเครื่องเจ้าของ จึงไม่เลือกในรุ่นแรก

## การใช้งานที่ต้องได้

- เปิดแอปครั้งแรก: นำเข้าการเชื่อมต่อ Supabase จากไฟล์ตั้งค่าส่วนตัวที่เจ้าของเลือกผ่านหน้าต่างเลือกไฟล์ของระบบ ตรวจข้อมูลที่จำเป็น และเก็บแบบเข้ารหัสบนเครื่อง ไม่แสดงรหัสในหน้าจอเว็บหรือ logs
- การนำเข้ารับเฉพาะการเชื่อมต่อฐานข้อมูลที่จำเป็น ไม่เรียก seed, reset, copy database หรือ migrations อัตโนมัติ ใช้บัญชีแอปเดิมเข้าสู่ระบบตามปกติ
- เปิดครั้งถัดไป: เริ่ม backend ที่บรรจุมากับแอป รอความพร้อม แล้วแสดงหน้าจอเดิม หากฐานข้อมูลติดต่อไม่ได้ แสดงสถานะตรงตามจริงและให้ลองเชื่อมต่อใหม่
- ปิดหน้าต่างสุดท้ายหรือกด Cmd-Q: จบแอปและ backend ทั้งหมด ไม่มี tray-only residency, login item, LaunchAgent หรือ tunnel
- เปิดซ้ำ: โฟกัสหน้าต่างเดิม ไม่สร้าง backend ซ้อน
- ข้อมูลร่างและรายการเงินที่รอทราบผลต้องกลับมาได้หลังเปิดแอปใหม่ ใช้ idempotency key และเนื้อหาคำขอเดิมจนยืนยันผลได้ ไม่ส่งรายการเงินซ้ำแบบเงียบ ๆ
- เมื่ออินเทอร์เน็ตขาด ไม่แสดงว่ารายการบันทึกสำเร็จถ้ายังยืนยันกับ Supabase ไม่ได้ การแสดงข้อมูลตัวอย่างหรือข้อมูลที่ตรวจสอบไม่ได้ต้องมีป้ายกำกับตามพฤติกรรมเดิม

## โครงสร้างและวงจรชีวิต

- Electron main process จัดการหน้าต่าง การตั้งค่าส่วนตัว และ backend ที่เป็น child process
- บรรจุ production Next.js standalone output, public assets, .next/static, Prisma client และ native engine สำหรับ darwin-arm64 ให้ครบ
- Runtime ต้องมากับแอป ไม่พึ่ง Node/npm/Homebrew ที่ติดตั้งไว้ในเครื่อง หากใช้ Electron UtilityProcess ต้องผ่านการทดสอบ Prisma native engine ในแอปที่แพ็กแล้ว หากไม่เข้ากัน ให้บรรจุ Node LTS ที่รองรับเป็น runtime แยกโดยคงพฤติกรรมภายนอกเดิม
- ใช้ origin คงที่ `http://127.0.0.1:43187` และ Electron browser partition ที่คงอยู่ข้ามการเปิดและอัปเดต เพื่อรักษา drafts, pending requests และ cookies
- ถ้า port ถูกใช้งานอยู่ ต้องหยุดพร้อมข้อความแก้ไขที่เข้าใจได้ ห้ามเปลี่ยน port เงียบ ๆ ห้ามยึด process อื่น และห้ามเปิดหน้าจอของ server ที่ตรวจว่าเป็นของแอปไม่ได้
- Backend ฟังเฉพาะ loopback และตรวจ capability สุ่มใหม่ทุกครั้งก่อนส่งคำขอเข้า Next.js สำหรับทุกเส้นทาง รวม assets, health และ login ตัวแอปแนบ capability เฉพาะ origin ของตัวเอง ไม่ใส่ใน URL หรือ logs และรองรับ internal session fetch ของ middleware ด้วย
- แยก startup/availability ออกจาก backup readiness: สำรองข้อมูลเก่าไม่ได้แปลว่าเปิดแอปไม่ได้ และ database down ต้องไม่ถูกแสดงเป็นพร้อมใช้งาน
- เมื่อเริ่มไม่สำเร็จ ปิดแอป หรือ main process ตาย ต้องเก็บกวาดเฉพาะ child process ของแอป มี graceful shutdown ที่จำกัดเวลาและกลไกหยุดเมื่อ parent หาย ตรวจทั้งการออกปกติและ force quit จริง

## ข้อมูลและความปลอดภัย

- เก็บ database connection และ session secret แบบเข้ารหัสภายใต้ userData ของแอป โดยใช้ macOS Keychain-backed safeStorage เลือก API ให้ตรงกับ Electron version ที่ pin และไม่ fallback เป็น plaintext เมื่อ Keychain ใช้งานไม่ได้
- Session secret คงเดิมข้ามการเปิดแอป ส่วน transport capability เปลี่ยนทุกครั้ง Credentials ส่งให้ backend เท่านั้น ไม่มี IPC สำหรับอ่าน secrets ออกสู่ renderer
- ไม่บรรจุ `.env`, `.yogurt`, backups, ใบเสร็จจริง หรือค่าการเชื่อมต่อจริงใน app/DMG/archive ต้องสแกน artifact ที่สร้างเสร็จด้วย เพราะ standalone tracing อาจรวมไฟล์ที่ไม่ต้องการ
- Renderer ใช้ `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` และคง web security จำกัด navigation, หน้าต่างใหม่, external links, permissions และ IPC sender ให้ตรงขอบเขตแอป
- ทดสอบ production Secure cookies ใน Chromium loopback จริง ไม่สลับทั้งระบบไป development mode เพื่อข้ามปัญหา cookies
- การเชื่อม PostgreSQL โดยตรงเหมาะกับเครื่องเจ้าของที่ไว้ใจได้ ผู้ควบคุมเครื่องสามารถเข้าถึง credentials ของแอปได้ จึงไม่แจกการตั้งค่ารูปแบบนี้ให้เครื่องพนักงานที่ไม่ไว้ใจ หากต้องขยายไปพนักงาน ต้องออกแบบ backend/สิทธิ์ฐานข้อมูลแยกต่างหาก

## ไฟล์ส่วนตัวและการสำรอง

- แยก immutable app resources ออกจาก writable data ใช้ data directory ส่วนตัวภายใต้ `app.getPath('userData')` สำหรับ receipts, metrics และ backup evidence สิทธิ์ directory 0700 และไฟล์ส่วนตัว 0600
- เพิ่ม data-root helper ที่ระบุได้ชัดเจน ไม่เปลี่ยน `process.cwd()` ทั้งระบบ เพราะ build metadata และ assets ต้องอ่านจาก app resources
- นำเข้าใบเสร็จเดิมผ่านการคัดลอกและตรวจ checksum ก่อนใช้งาน ไม่ลบต้นฉบับอัตโนมัติ อัปเดตแอปต้องไม่ลบใบเสร็จ การตั้งค่า browser storage หรือ drafts
- ไม่เปิดตารางสำรองข้อมูล PostgreSQL หรือบริการ Mac เดิมกลับมา หน้า operations ต้องรายงาน missing/stale/unverified ตามหลักฐานจริง ไม่ตีความว่าการใช้ Supabase แปลว่ามี backup ที่ทดสอบแล้ว
- รุ่นแรกคงเครื่องมือ backup/restore ที่มีอยู่เป็นเครื่องมือดูแลแบบสั่งเอง แยกจากการเปิดแอปประจำวัน และระบุว่าการสำรองฐานข้อมูลและใบเสร็จยังต้องดูแล ไม่เพิ่ม scheduler ที่รันตอนปิดแอป

## จุดที่ต้องแก้เมื่อเริ่มพัฒนา

- `package.json`, `next.config.ts` และ desktop launcher/packaging ใหม่
- `src/lib/receipt-storage.ts` และ helper สำหรับ runtime data root
- `src/lib/backup-readiness.ts`, `src/app/operations/page.tsx`, `src/app/api/health/route.ts`
- `src/app/api/metrics/web-vitals/route.ts` แยกตำแหน่งเขียน metrics ออกจาก build metadata
- เส้นทาง local request guard และ `middleware.ts` สำหรับขอบเขตแอป โดยคง authorization และ business routes เดิม
- เอกสารติดตั้ง ใช้งาน สำรอง อัปเดต และข้อจำกัดของรุ่นใช้เอง

## ผลลัพธ์และเกณฑ์ตรวจรับ

ผลลัพธ์หลังพัฒนาคือ `.app` และ `.dmg` สำหรับ Mac arm64 พร้อมซอร์สและวิธี build ตัวแอปใช้เองต้องระบุสถานะ code signing/notarization ตามจริง ไม่ซื้อสมาชิก Apple หรืออ้างว่าเป็นรุ่นเผยแพร่ที่ notarized โดยอัตโนมัติ

ตรวจรับอย่างน้อยดังนี้:

1. ติดตั้งและเปิดจากนอก repository รวม path ที่มีช่องว่าง โดยไม่อาศัย system Node/npm
2. ล็อกอิน ใช้ session และทำงานกับ Prisma ใน production package ได้
3. ทดสอบรายการเงิน/สต็อกกับข้อมูล scratch ที่แยกจาก production ไม่สร้างรายการทดลองใน Supabase จริง
4. ปิด–เปิดแอปแล้วยังมี drafts และ pending request เดิม การส่งซ้ำต้องไม่สร้างรายการเงินซ้ำ
5. ใบเสร็จอ่านได้หลังปิด–เปิดและอัปเดต พร้อมตรวจการนำเข้าที่ถูกขัดจังหวะ
6. เน็ตขาด/กลับมา: สถานะบันทึกถูกต้องและมีทางแก้ไข ไม่สูญข้อมูลที่เก็บไว้
7. เปิดแอปซ้ำและ port collision จัดการได้โดยไม่ยึด process อื่นหรือเปลี่ยน origin
8. Browser ปกติและ foreign origin เรียก backend ไม่ได้ ไม่มี listener บน LAN
9. ปิดหน้าต่าง, Cmd-Q, startup failure และ force quit ไม่เหลือ backend/listener ของแอป
10. สแกนแอป/DMG/archive แล้วไม่พบ secrets หรือ private runtime data และบริการ hosting เดิมยังหยุดอยู่
11. รันชุดตรวจเดิมที่เกี่ยวข้อง พร้อมตรวจหน้าจอแอปจริงตาม Lao-first design และรายงานข้อจำกัดที่ยังตรวจไม่ได้

## เอกสารอ้างอิง

- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Electron application lifecycle](https://www.electronjs.org/docs/latest/api/app)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage / Keychain](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Electron native module compatibility](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

การสำรวจก่อนอนุมัติเป็นการอ่านซอร์สและเอกสารเท่านั้น ผลการพัฒนาและตรวจรับต้องบันทึกแยกตามหลักฐานที่เกิดขึ้นจริง
