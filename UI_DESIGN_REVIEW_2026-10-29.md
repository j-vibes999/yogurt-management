# ผลตรวจและแก้ความสมบูรณ์ของหน้าจอ

ตรวจ 28–29 ตุลาคม 2026 เขต Asia/Vientiane — อัปเดตระบบจริงและตรวจหลังอัปเดตแล้ววันที่ 29 ตุลาคม เวลา 00:18 น.

โค้ดที่ deploy: `9c5aa08bbdfb532eb0bb1143d55ea965de7810db` ต่อจาก `6a345f4` การแก้รอบนี้ยึด PRODUCT.md, DESIGN.md และชุดสีหมวดงานเดิม ใช้ Noto Sans Lao, custom CSS และ Radix ต่อ ไม่เปลี่ยนสูตรเงิน/สต็อก สิทธิ์ backend หรือ schema ฐานข้อมูล

**พบความไม่สมบูรณ์จริงหลายจุด ทั้งหน้าจอว่างที่ไม่มีสไตล์ ฟอร์มที่ถูกซ่อน หน้าต่างที่กดไม่ได้ และทางไปต่อที่ไม่ตรงสิทธิ์ แก้และตรวจยืนยันประเด็นในตารางด้านล่างแล้ว** ขอบเขตที่ทดสอบไม่ได้เท่ากับการรับรองทุก browser/device/state

## ประเด็นที่แก้แล้ว

| ระดับ | ก่อนแก้ | หลังแก้และหลักฐาน |
|---|---|---|
| P1 | หน้าต่างแก้วัตถุดิบใช้ overlay z300 แต่ตัวหน้าต่าง z101 บนจอแคบ มองเห็นแต่กดติดฉากหลัง | แยก sibling layers ที่300/301 มี scroll containment/ตัดบรรทัดชื่อยาว; browser390px ยืนยัน element ด้านหน้าอยู่ใน dialog และกดยกเลิกปิดได้ |
| P1 | ส่วนตัดของเสียในหน้าผลิตเป็น native details ที่ปิดอยู่ ขณะ desktop ซ่อน summary ทำให้ทั้งส่วนสูง0px และเปิดไม่ได้ | ใช้ ResponsiveDisclosure ที่มีอยู่ เปิดบน desktop และยุบได้บนมือถือ; ตรวจว่าไม่มี closed details ที่ซ่อน summary ในหน้าที่สำรวจ |
| P2 | EmptyState ใช้ชุด class ที่ไม่มี CSS ทำให้หลาย directory เหลือไอคอนกับข้อความติดกัน | ใช้ shared empty-state layout แยก icon/title/description/action และ compact mode ครอบคลุม directory ที่ใช้คอมโพเนนต์ร่วมกัน |
| P2 | รายงานที่ไม่มีรายการขายเหลือหัวข้อกับ panel ว่าง | เพิ่มคำอธิบายช่วงเวลาที่ไม่มีข้อมูลและทางไปประวัติปิดรอบ |
| P2 | เพิ่มร้านยังสองคอลัมน์บนจอแคบ ช่องกรอก/ปุ่มบางชนิดสูง38–40px และ CSS เก่าทับ44px | ภายในฟอร์มร้านเรียงคอลัมน์เดียวเมื่อแคบ ใช้ shared control variables40px desktop/44px mobile+coarse pointer; ตรวจ visible buttons/inputs/selects ใน24เส้นทางที่390px ไม่พบตัวที่ต่ำกว่า44px |
| P2 | ช่องกรอกในแถวเดียวกันยืด/เลื่อนลงเมื่ออีกช่องมี help text | จัด fields จากด้านบนและแก้ spacing ของ help text; ตรวจแถวฟอร์มรายจ่ายมี top และความสูงตรงกัน |
| P2 | Search inputs มีกรอบซ้อนใน wrapper ที่มีกรอบอยู่แล้ว; Operations มีพื้น panel ซ้อนรอบสอง panel จนเกิดพื้นที่ขาวเกินจำเป็น | ให้ search wrapper เป็นเจ้าของขอบ และถอดพื้น panel ที่ซ้อนออกจาก container ของ Operations |
| P2 | หน้า stores/detail/refills แสดงปุ่มเพิ่มร้าน แก้ร้าน กวาดร้าน รับเงิน หรือสร้าง refill ให้ role ที่เข้าไม่ได้ | derive action จาก current server session และ access policy เดิม; SSR12กรณี admin/production/driver ไม่พบลิงก์ไปหน้าที่ role นั้นเข้าไม่ได้ |
| P2 | กดสร้างคำขอเติมจากร้านแล้ว `?storeId=` หาย ต้องเลือกร้านใหม่ | ตรวจ ID กับตัวเลือกที่ยังใช้งานได้และมีตู้ แล้ว preselect; กรณีลิงก์เก่ามี recovery; admin/driver เลือกร้านตรงตามลิงก์จริง |
| P2 | คำขอเติมจำนวน0ทุกรายการไม่มีคำอธิบายข้างช่อง | แสดง error และย้าย focus ไปจำนวนรายการแรกก่อนส่งคำขอ; browser ยืนยันข้อความ/focus |
| P2 | ไม่มีสูตรผลิตหรือใส่จำนวนผิดแล้วเจอ select ว่าง/ปุ่มปิดโดยไม่รู้เหตุผล | มี empty prerequisite guidance และ quantity validation พร้อม limit; browser100001ถ้วยแสดงข้อผิดพลาดที่ผูกกับช่อง |
| P2 | เพิ่มสินค้า/วัตถุดิบใน Operations แล้ว recipe options/counts ในอีกแท็บเก่า; สินค้าแรกไม่ถูกเลือกใน recipe editor | refresh shared server data หลังรับผลสำเร็จ และ reconcile การเลือกสินค้าแรก พร้อมคำอธิบายเมื่อยังไม่มีสินค้า/วัตถุดิบ |
| P2 | ล้างวันที่แก้รายจ่ายแล้ว validation ไม่แสดง; ปิดหน้าต่างได้ขณะ financial PATCH กำลังส่ง | มี adjacent date error/aria association; ปิด Escape/backdrop/X ระหว่างส่งไม่ได้; browser ยืนยันข้อความวันที่ผิดและ focus return จากหน้าต่างที่ตรวจ |
| P2 | ฟอร์มแก้ร้านนำ display placeholder `—` มาเป็นค่ากรอก และไม่มี dirty guard | อ่าน nullable raw values ที่ขอบเขต edit; browser contact/phone/WhatsApp/Facebook ว่างจริง และยกเลิก discard แล้วค่าร่างยังอยู่; lookup ล้มเหลวปิดการบันทึก |
| P2 | รหัสตู้ที่ไม่ใช่ FR ตัวเลขสั้น ๆ ล้นหมุดแผนที่ | หมุดใช้เลขสั้น/ลำดับคงที่ และเก็บรหัสเต็มในรายละเอียด/title/accessible name; ยืนยันหมุดแสดง1แทนรหัสยาว |
| P2 | คนขับทำครบแล้วเห็นข้อความค้นไม่พบ และตัวเลขสีขาวบนพื้นอ่อนอ่านยาก | แสดง completed state พร้อมปุ่มดูร้านทั้งหมดและใช้ semantic dark ink; browser กดดูทั้งหมดแล้วรายการกลับมา |
| P2 | ช่องนับสินค้าไม่ระบุ error เป็นรายช่อง | เชื่อม visible labels/id, aria-invalid และ adjacent error; browser ล้างค่าจำนวนแล้วข้อความผูกกับช่องและไม่ให้ไปต่อ |
| P2/P3 | Search ไม่ปิดเมื่อออกนอกส่วน, ปิดหน้าต่างตู้แล้ว focus ไม่กลับ, filter แจ้งเตือนไม่บอกการเลือก | เพิ่ม dismissal/focus restoration/aria-pressed/live count; browser ยืนยันคืน focus ไปปุ่มจัดการตู้ |
| P3 | loading copy ที่ตั้งใจซ่อนใช้ utility ที่ไม่มี, field help ไม่มีสไตล์ และ Operations ซ้อน main landmark | ใช้ visually-hidden เดิม เติม field-help และเปลี่ยนพื้นที่ข้อมูลหลักเป็น labeled section |

## ความครอบคลุม

ตรวจ source และภาพจาก build บนฐานข้อมูลสำเนาสังเคราะห์ที่1280×720และ390×844 ครบ24เส้นทาง:

- Dashboard: `/`
- ร้าน: `/stores`, `/stores/new`, `/stores/[id]`, `/stores/[id]/edit`
- แผนที่: `/map`
- เติมสินค้า: `/refills`, `/refills/new?storeId=…`
- คนขับ: `/driver`, `/driver/restock/[storeId]`, โหมด `?mode=payment`
- รับเงิน: `/settlements`
- วัตถุดิบ: `/inventory`, `/inventory/receive`, `/inventory/adjust`
- ผลิต: `/production`, ประวัติ `?historyPage=1`
- รายจ่าย: `/expenses`, `/expenses/new`, `/expenses/[id]/edit`
- `/reports`, `/operations`, `/notifications`, `/audit-log`

มี intermediate checks ที่768×1024 สำหรับเพิ่มร้าน/วัตถุดิบ/Operations และตรวจหน้า login ระหว่างใช้ clone/หลัง deploy การตรวจ DOM รอบเต็มไม่พบ document horizontal overflow, visible unlabeled inputs หรือ closed details ที่ไม่มีทางเปิดในเส้นทางที่ตรวจ ส่วน responsive overlays และ action สำคัญตรวจด้วยการกดจริงเพิ่มเติมตามตาราง

## หลักฐานทดสอบและ release

- `npm run verify` ผ่าน: Prisma validation/generate, ESLint, TypeScript, **168/168 tests, fail0, skip0** และ production build
- DR จาก backup Supabase ลง local clone กับ build ล่าสุดผ่าน: authenticated smoke, business workflow, FEFO/expired exclusion/cost snapshots, concurrent replay/stock competition/multi-SKU rollback และ daily closing conflicts
- Offline fallback E2E ผ่าน
- Role/page SSR12กรณีผ่าน รวม production ที่ต้อง redirect307 เมื่อเข้าหน้าสร้าง refill และ admin/driver ที่ preselect ร้านถูก
- Impeccable mechanical scan ไม่พบ findings:23 markup targets ในชุดแรก และ3 targets ที่เพิ่มภายหลัง scan แรก; CSS ตรวจจาก source/computed layout/ภาพจริง
- มี independent source review และแบ่งตรวจภาพ desktop/mobile โดย agents อื่นร่วมกับการตรวจของผู้รวมงาน
- `Apply Yogurt Update.command` สำเร็จ:168 tests → backupพร้อมrestore → build → ไม่มี migration pending → start → checks ไม่เกิด rollback รอบนี้
- backup ก่อน deploy: `yogurt_ops-20261029-001731-61929.dump`; ตรวจข้อมูลเดิมก่อน fixtures: users3, stores0, materials9, settlements0, auditLogs3 ไม่มีการ seed/reset ข้อมูลจริง
- ตรวจหลัง deploy00:18: local/public health HTTP200 status`ok`; local availability/readiness/DB/restore`ok`; login200; protected stores/operations307เมื่อไม่ล็อกอิน; session/daily-closing401 โค้ดใน `.yogurt/deployed-commit` ตรง9c5aa08

ภาพทั้งหมดเป็นข้อมูลสังเคราะห์จาก local clone:

- [หน้าต่างวัตถุดิบบนมือถือ](docs/verification/design-2026-10-29/material-mobile.png)
- [คนขับทำงานครบ](docs/verification/design-2026-10-29/driver-complete-mobile.png)
- [รายจ่าย desktop](docs/verification/design-2026-10-29/expenses-new-desktop.png)
- [แผนที่](docs/verification/design-2026-10-29/map-desktop.png)
- [Operations](docs/verification/design-2026-10-29/operations-desktop.png)
- [ผลิต](docs/verification/design-2026-10-29/production-desktop.png)

## ข้อจำกัดของผลตรวจ

Viewport emulation และ mouse/keyboard ไม่เท่ากับโทรศัพท์จริง ยังไม่ได้รับรอง software keyboard, safe-area/gesture ทุกเครื่อง, screen reader ทุก flow, ทุก browser หรือ load/soak test ทดสอบสถานะว่าง/มีข้อมูล/validation/recovery ตามกรณีที่บันทึก ไม่อ้างว่าครอบคลุมทุก state combination

Search outside-dismissal, pending expense dismissal guard และ first-product refresh มี source review/targeted lint/type verification; ไม่ได้จำลอง network delay ทุกจังหวะหรือทดสอบทุก race ผ่าน browser จริง การเปลี่ยน store edit ไม่ได้ซ่อมย้อนหลังค่าขีดที่อาจถูกบันทึกในอดีต

Run notes: targetคือOperational UI completeness;ไม่มี detector ignore เพิ่ม; browserทำงานแบบ hidden; overlay injection ไม่ใช้เพราะ evaluate API เป็น read-only และไม่เริ่ม Impeccable live-server; คืน viewport และปิดแท็บแล้ว หยุด previewและลบเฉพาะฐานข้อมูลทดสอบที่ตั้งชื่อไว้ credentials สังเคราะห์ไม่ถูก commit หลักฐานก่อน/หลังและ logs เก็บใน ignored `.yogurt/design-verification-2026-10-29/` ของ checkout จริง

ตรวจอ้างอิง [Web Interface Guidelines ปัจจุบัน](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) ร่วมกับข้อกำหนดโปรเจกต์ โดย PRODUCT.md/DESIGN.md มีอำนาจเหนือ generic defaults งานรอบนี้ไม่เปลี่ยนทิศทางดีไซน์และไม่ติดตั้งชุด UI ใหม่
