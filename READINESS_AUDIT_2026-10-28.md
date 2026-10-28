# ผลตรวจความพร้อม Yogurt Super Web

> สถานะหลังแก้ไขและ deploy วันที่ 28 ตุลาคม 2026 ดู [ผลแก้ไขและตรวจหลังอัปเดต](READINESS_FIXES_2026-10-28.md) รายงานด้านล่างเก็บข้อค้นพบก่อนแก้ไขไว้เป็นประวัติ

ตรวจวันที่ 28 ตุลาคม 2026 เวลาในเขต Asia/Vientiane — source commit `f31c9d7`

**ข้อสรุป: โค้ดหลักและขั้นตอนธุรกิจที่ทดสอบทำงานได้ แต่ยังไม่ควรรับรองพร้อมใช้งาน production เต็มรูปแบบ จนกว่าจะปิดความเสี่ยงสิทธิ์ฐานข้อมูลและพิสูจน์การสำรอง/กู้คืนหลังย้ายไป Supabase ได้สำเร็จ**

รายงานนี้เป็นการตรวจ ไม่ได้แก้ไข source code, สิทธิ์ฐานข้อมูล, ข้อมูลธุรกิจ, deployment หรือการตั้งค่าบริการจริง มีเพียงไฟล์รายงานนี้ที่เพิ่มใน repository การทดสอบที่มีการเขียนข้อมูลทำบนฐานข้อมูลชั่วคราวใน Mac และใช้ server ทดสอบแยกจาก port 3000

## 1. ผลตรวจที่ยืนยันแล้ว

| รายการ | ผล | ขอบเขต/ข้อจำกัด |
|---|---|---|
| Unit/regression tests | ผ่าน 124/124; fail 0, skip 0 | มีทั้ง pure calculations, mock route tests และ source-pattern assertions; ไม่ใช่ browser E2E ทั้งหมด |
| ESLint | ผ่าน | `npm run lint` |
| TypeScript | ผ่าน | `npm run typecheck` |
| Prisma schema validation | ผ่าน | `npx prisma validate` |
| Production build | ผ่าน | `npm run build` บนสำเนาโครงการแยก; ไม่เขียนทับ `.next` ที่ production ใช้ |
| Dependency audit | พบช่องโหว่ที่ registry รายงาน 0 รายการ | `npm audit --json`; ไม่ใช่การรับรองว่าไม่มีช่องโหว่ทุกประเภท |
| Authenticated smoke E2E | ผ่าน | สร้างบัญชีทดสอบใหม่ในฐานข้อมูลสำเนา local; ตรวจหน้าหลักและการบันทึก material/product |
| Business workflow E2E | ผ่าน | ฐานข้อมูลสำเนา local; production, refill request, restock, settlement, retry, concurrency และ report regressions ตาม assertion ใน suite |
| Refill integration probe เพิ่มเติม | ผ่าน | actual HTTP + PostgreSQL ใน clone: FEFO, ไม่ใช้ batch หมดอายุ, lot cost snapshots, concurrent completion/replay, แย่ง stock และ rollback ทั้ง multi-SKU |
| Offline E2E ที่อยู่ใน repository | **ไม่ผ่าน** | fixture cookie ไม่มี `sid`; ได้ 401 แทน 200 |
| Offline probe หลังเติม `sid` เฉพาะสำเนาทดสอบ | ผ่าน | ยืนยัน read-only demo fallback และไม่ยอมบันทึกรับเงินเมื่อ DB ใช้ไม่ได้; ไม่ได้แก้ test ใน repository |
| Live local/public health | HTTP 200 / status `ok` ณ เวลาตรวจ | ยืนยันการตอบสนองขณะตรวจ; ไม่ใช่หลักฐานความพร้อมของ restore หรือ uptime ระยะยาว |
| Live API authentication | ไม่ล็อกอินได้ 401; หน้าหลัก redirect ไป login | ตรวจ session/users/receipts และ cross-site mutation guards |
| ฐานข้อมูล production | Supabase PostgreSQL 17.11 | Mac มี PostgreSQL 16 สำหรับฐานข้อมูลเดิม/ฐานข้อมูลทดสอบ |
| Migration records | มีครบ 13 รายการ ไม่มี pending | checksum ของ migration 2 รายการไม่ตรง source ปัจจุบัน ดูข้อ 13 |
| Data invariants | ไม่พบ stock ติดลบ, batch balance ผิด, settlement equation ผิด หรือ lot stock เกิน inventory ใน aggregate ที่ตรวจ | production ปัจจุบันมีธุรกรรมน้อย/ว่าง จึงไม่ถือเป็นหลักฐานสำหรับข้อมูลทุกสถานการณ์ |
| สร้าง backup ใหม่จาก Supabase | ผ่านบนสำเนาสคริปต์/โฟลเดอร์แยก | ใช้ database จริงแบบอ่านอย่างเดียว; ปิดตัวส่งแจ้งเตือนเฉพาะสำเนาทดสอบ |
| กู้ backup ใหม่นั้นลง Mac | **ไม่ผ่าน** | `extension "supabase_vault" is not available` |
| Disaster recovery drill | **ไม่ผ่านขั้นตอน restore** | พบ `TMP_URL: unbound variable`; ทดสอบโดยแทน create/drop database เป็น no-op เพื่อไม่แตะฐานข้อมูล |

ฐานข้อมูล Supabase ปัจจุบันมี users 3, products 2, raw materials 9, stores 0, production batches 0, settlements 0, refill requests 0, restock visits 0 สอดคล้องกับบันทึกย้ายระบบวันที่ 27 ตุลาคมที่เก็บเฉพาะข้อมูลตั้งต้นและเริ่มงานใหม่ ไม่ใช่หลักฐานว่าข้อมูลหายโดยไม่ตั้งใจ ก่อนใช้งานต้องเตรียมร้าน ตู้แช่ และสต็อกจริง

## 2. ประเด็นเร่งด่วนก่อนใช้งาน production

### 1) P1 — สิทธิ์ `anon`/`authenticated` เข้าถึงตารางธุรกิจบน Supabase ได้กว้างเกินไป

**หลักฐาน:** ตารางใน public schema ทั้ง 26 ตารางปิด RLS และให้สิทธิ์ SELECT/INSERT/UPDATE/DELETE/TRUNCATE แก่ `anon` และ `authenticated` การทดสอบใน transaction แบบอ่านอย่างเดียวด้วย `SET LOCAL ROLE anon` อ่านจำนวน users ได้ 3 แถว และ `has_table_privilege` คืน true สำหรับ UPDATE/TRUNCATE บน users ไม่ได้อ่าน hash รหัสผ่านหรือแก้ข้อมูล

**ผลกระทบ:** หาก Supabase Data API เปิดอยู่ และผู้โจมตีเข้าถึง project endpoint พร้อม publishable/anon key จะมีช่องทางอ่าน/แก้ข้อมูลข้ามการตรวจสิทธิ์ของ Next.js รวมถึง users, user_sessions และข้อมูลเงิน **ยังไม่ได้ยืนยันการตั้งค่า Data API หรือทำการโจมตีผ่าน endpoint ภายนอก จึงไม่กล่าวว่าพบการรั่วไหลจริงแล้ว**

**ตำแหน่งเกี่ยวข้อง:** [lib-supabase.sh:78](/Users/justkay/Projects/Yogurt_Super_Web/scripts/lib-supabase.sh:78), [move-to-supabase.sh:77](/Users/justkay/Projects/Yogurt_Super_Web/scripts/move-to-supabase.sh:77) คัดลอก schema แต่ไม่มีขั้นตอนปิดสิทธิ์ของ API roles บนปลายทาง

**ควรแก้:** ตรวจและปิด Data API หากระบบใช้ Prisma ฝั่ง server อย่างเดียว หรือถอนสิทธิ์ API roles จากตาราง/sequence/function ที่ไม่ควรเปิด รวม default privileges สำหรับวัตถุใหม่ แยก backend role และกำหนด RLS เฉพาะ API ที่ต้องเปิดจริง ทดสอบว่า API roles อ่านและเขียน users/การเงินไม่ได้ โดย backend ยังทำงานได้

เอกสาร [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api) อธิบาย grant/RLS และการปิด Data API เมื่อไม่ได้ใช้; การมี Prisma authentication ไม่ปิดช่องทาง Data API ให้อัตโนมัติ

### 2) P1 — Backup จาก Supabase ยัง restore ตามวิธีที่คู่มือระบุไม่ได้

**หลักฐาน:** รัน `scripts/backup-db.sh` จากสำเนาโครงการที่ใช้ Supabase แบบอ่านอย่างเดียวได้ dump สำเร็จ แล้วรัน `scripts/verify-backup-restore.sh` จากสำเนานั้น กู้ลงฐานข้อมูล local ชั่วคราวไม่ได้ เพราะ `supabase_vault` extension ไม่มีใน PostgreSQL 16 บน Mac ฐานข้อมูลชั่วคราวถูกลบหลังทดสอบ

**สาเหตุ:** [backup-db.sh:23](/Users/justkay/Projects/Yogurt_Super_Web/scripts/backup-db.sh:23) dump ทั้ง database รวมวัตถุของ Supabase ขณะที่ [verify-backup-restore.sh:20](/Users/justkay/Projects/Yogurt_Super_Web/scripts/verify-backup-restore.sh:20) กู้ลง Mac และ [lib-env.sh:35](/Users/justkay/Projects/Yogurt_Super_Web/scripts/lib-env.sh:35) แก้เฉพาะความต่าง `transaction_timeout` ไม่ได้จัดการ extension/schema ของ Supabase

**ผลกระทบ:** มีไฟล์ dump และ checksum ก็ยังไม่เพียงพอสำหรับการกู้ระบบหลังเหตุขัดข้อง วิธีปัจจุบันหยุดก่อนตรวจข้อมูลและเปิดแอปจากสำเนาที่กู้

**ควรแก้:** กำหนดขอบเขต backup ของ application schema/objects ให้เหมาะกับเครื่องกู้คืน หรือใช้ target ที่รองรับ extension ของ dump แล้วพิสูจน์ครบ dump → restore → ตรวจ invariants → เปิดแอป → ทำธุรกรรมบนสำเนาที่กู้คืน

### 3) P1 — สคริปต์ซ้อมกู้คืนมีคำสั่งกำหนดตัวแปรอยู่หลัง comment

**ตำแหน่ง:** [disaster-recovery-drill.sh:9](/Users/justkay/Projects/Yogurt_Super_Web/scripts/disaster-recovery-drill.sh:9)

บรรทัดกำหนด `TMP_URL=...` อยู่หลัง `#` ในบรรทัดเดียวกันกับ `TMP_DB` จึงไม่ถูก execute แต่บรรทัด 14 เรียกใช้ตัวแปรนี้ภายใต้ `set -u`

**หลักฐาน:** รันสำเนาสคริปต์โดย mock create/drop database เป็น no-op ได้ `scripts/disaster-recovery-drill.sh: line 14: TMP_URL: unbound variable` ไม่ได้สร้างหรือแก้ฐานข้อมูลจริง

**ควรแก้:** แยกการกำหนด `TMP_URL` เป็นคำสั่งต่างหาก เพิ่ม smoke test ที่ execute สคริปต์ด้วย test doubles แทนการตรวจว่ามีชื่อคำสั่งอยู่ใน source และรัน drill เต็มอีกครั้งหลังแก้ปัญหา restore ในข้อ 2

### 4) P1 — งานสำรองข้อมูลหลังย้ายฐานข้อมูลยังไม่มีผลสำเร็จที่ยืนยันใน runtime directory จริง

**หลักฐาน ณ เวลาตรวจ:** `.yogurt/backups/latest.json` ยังชี้ dump วันที่ **27 ตุลาคม 2026 เวลา 14:49:02** ซึ่งเป็น backup ของฐานข้อมูล local ก่อนย้าย มีไฟล์ `.dump.tmp` ขนาด 0 จากวันที่ 28 ตุลาคม เวลา 03:18 และ backup error log รายงาน resolve Supabase hostname ไม่ได้ ไม่พบ `last-restore-verification.json` ใน directory จริง

การ dump ใหม่ระหว่าง audit สำเร็จใน directory ทดสอบ แต่ไม่ได้อัปเดตสถานะ backup ของ production และยัง restore ไม่ผ่านตามข้อ 2 จึงไม่ถือว่างาน backup ประจำวันกลับมาพร้อมแล้ว ไม่ได้ตรวจสถานะ backup ที่ Supabase provider อาจมีแยกต่างหาก

**ควรแก้:** ยืนยันงานตามตารางทำ backup หลังย้ายได้จริง จัดการกรณี DNS/network ล้มเหลว และสร้าง metadata ที่ผูกกับ database target ปัจจุบัน พร้อมผล restore ล่าสุด

## 3. ความถูกต้องของเงินและความปลอดภัยที่ควรแก้ต่อ

### 5) P2 — เปิดแก้ยอดปิดวันเดิมแล้วบันทึก อาจเขียนยอดอื่นทับเป็นศูนย์

**ตำแหน่ง:** [operations-forms.tsx:45](/Users/justkay/Projects/Yogurt_Super_Web/src/components/operations-forms.tsx:45), [daily-closing/route.ts:36](/Users/justkay/Projects/Yogurt_Super_Web/src/app/api/daily-closing/route.ts:36)

ฟอร์มเริ่ม cash/bank/expense เป็น 0 และไม่ดึงยอดของวันที่เลือก API upsert ทับทั้งสามยอดโดยไม่ตรวจ version/snapshot ตัวอย่างเดิม `100 / 200 / 30` ผู้ใช้เปิดใหม่แก้แค่ cash เป็น 110 จะส่งและบันทึก `110 / 0 / 0` ผู้ดูแลสองคนอาจเขียนทับกันได้ด้วย

**หลักฐาน:** ยืนยันทั้ง actual route ในหน่วยความจำ และ actual HTTP + PostgreSQL บนฐานข้อมูล clone: สร้างยอด `100 / 200 / 30` แล้วส่งค่าตาม default ของฟอร์มที่แก้เพียง cash ผลที่อ่านกลับเป็น `110 / 0 / 0` ไม่ได้เปลี่ยนยอดจริง Audit log เก็บ before/after ช่วยค้นย้อนหลัง แต่ไม่ป้องกันความผิดพลาด

**ควรแก้:** โหลดรายการเดิมเมื่อเลือกวัน แสดงโหมดสร้าง/แก้ให้ชัด ตรวจ expected version/snapshot และแสดง conflict เมื่อข้อมูลเปลี่ยน

### 6) P2 — Export CSV บางจุดยังเปิดให้ spreadsheet ตีความข้อมูลเป็นสูตร

**ตำแหน่ง:** [csv-export-button.tsx:4](/Users/justkay/Projects/Yogurt_Super_Web/src/components/csv-export-button.tsx:4), [inventory/adjust/route.ts:46](/Users/justkay/Projects/Yogurt_Super_Web/src/app/api/inventory/adjust/route.ts:46), [inventory/page.tsx:19](/Users/justkay/Projects/Yogurt_Super_Web/src/app/inventory/page.tsx:19)

ผู้ใช้ production เปลี่ยนชื่อวัตถุดิบเป็น `=1+1` ได้ และ generic CSV export ใส่เพียง double quotes ซึ่งไม่หยุด spreadsheet formula การทดสอบ actual handler แบบ mock ยอมรับชื่อดังกล่าวและ exporter สร้าง cell `"=1+1"`

**ควรแก้:** ใช้การ neutralize สูตรร่วมกันกับ helper ที่มีแล้วใน [report-csv.ts:7](/Users/justkay/Projects/Yogurt_Super_Web/src/lib/report-csv.ts:7) โดยยังรักษาการแสดงตัวเลขและภาษา Lao

### 7) P2 — ส่งคำขอล็อกอินพร้อมกันสามารถเกิน IP limit ที่ตั้งไว้

**ตำแหน่ง:** [login/route.ts:36](/Users/justkay/Projects/Yogurt_Super_Web/src/app/api/auth/login/route.ts:36), [login-rate-limit.ts:25](/Users/justkay/Projects/Yogurt_Super_Web/src/lib/login-rate-limit.ts:25)

ระบบตรวจ bucket ก่อน `await` แต่ยังไม่จองจำนวน attempt จนกว่าจะตรวจรหัสผ่านไม่ผ่าน agent ส่ง 25 คำขอคนละ email จาก IP เดียวใน isolated harness ที่ใช้ actual handler/limiter พบทั้ง 25 คำขอถึง password verification และได้ 401 แม้ cap เท่ากับ 10 คำขอถัดไปจึงถูกบล็อก

**ผลกระทบ:** ลดประสิทธิภาพของการจำกัด brute force/CPU load ส่วน account lockout ยังมีอยู่ จึงไม่ใช่ข้อค้นพบว่า authentication ถูกข้ามสำเร็จ

**ควรแก้:** จอง attempt แบบ atomic ก่อนงาน async และทดสอบ concurrent requests ขณะยังรักษา account lockout

### 8) P2 — Migration ต้นทุนของเสียไม่ backfill ข้อมูลประวัติ

**ตำแหน่ง:** [waste-cost migration:2](/Users/justkay/Projects/Yogurt_Super_Web/prisma/migrations/20261013150000_waste_cost_tracking/migration.sql:2), [db-data.ts:861](/Users/justkay/Projects/Yogurt_Super_Web/src/lib/db-data.ts:861)

รายการคืนของเสียเก่าได้รับ `expired_cost=0` และ `expired_unknown_units=0` ทำให้รายงานนับต้นทุนเป็นศูนย์และถือว่ารู้ต้นทุนแล้ว ส่วน central write-off เก่าตั้ง `cost_known=false`, `unit_cost=0` แม้ linked batch อาจมีต้นทุนจริง

**ผลกระทบ:** เมื่อนำฐานข้อมูลประวัติก่อน migration มาอัปเกรด รายงานกำไรอาจสูงเกินจริงหรือใช้ estimate โดยไม่จำเป็น **aggregate production ปัจจุบันพบ candidate ที่ได้รับผลกระทบ 0 รายการ** จึงไม่กล่าวว่ารายงานปัจจุบันเสียแล้ว

**ควรแก้:** เพิ่ม corrective migration เพื่อกู้ actual cost จาก provenance ที่มี หรือ mark unknown units อย่างถูกต้อง และทดสอบการอัปเกรดจาก fixture ก่อน migration

## 4. การใช้งานหน้าจอและการกู้จากความผิดพลาด

รายการด้านล่างตรวจจาก source; ยังไม่ได้ทดสอบทุกข้อผ่าน screen reader หรือมือถือจริง

| ความสำคัญ | ตำแหน่ง | ปัญหา/ผลกระทบ | แนวทางแก้ |
|---|---|---|---|
| P2 | [restock-audit-form.tsx:118](/Users/justkay/Projects/Yogurt_Super_Web/src/components/restock-audit-form.tsx:118) | สถานะ draft “saved” ถูกล้างเฉพาะเมื่อแก้จำนวนสินค้า; เปลี่ยนยอดเงินหรือวิธีจ่ายแล้วอาจยังขึ้น saved แต่ reload ได้ยอดเก่าที่เคยบันทึก | ทำ dirty tracking ครบทุกค่าที่อยู่ใน draft |
| P2 | [restock-audit-form.tsx:123](/Users/justkay/Projects/Yogurt_Super_Web/src/components/restock-audit-form.tsx:123) | draft ต้องกดบันทึกเอง ไม่มี dirty-navigation guard; เปลี่ยนหน้า/reload เสี่ยงเสียการนับที่ยังไม่ได้บันทึก | autosave draft หรือเตือนก่อนออก โดยรักษา stale-snapshot validation |
| P2 | [crud-forms.tsx:40](/Users/justkay/Projects/Yogurt_Super_Web/src/components/crud-forms.tsx:40), [restock-audit-form.tsx:177](/Users/justkay/Projects/Yogurt_Super_Web/src/components/restock-audit-form.tsx:177) | server errors ไม่มี live region/alert และไม่ย้าย focus ผู้ใช้ screen reader อาจไม่ทราบว่าบันทึกไม่ผ่าน | ใช้ InlineFeedback ที่มีอยู่ ผูกข้อความกับ field และจัด focus |
| P2 | [map/page.tsx:23](/Users/justkay/Projects/Yogurt_Super_Web/src/app/map/page.tsx:23), [store-map.tsx:56](/Users/justkay/Projects/Yogurt_Super_Web/src/components/store-map.tsx:56) | แสดงลิงก์ Add Store/Driver/Audit ให้บาง role ที่ไม่มีสิทธิ์ปลายทาง เป็นทางตันแม้ backend บล็อกถูกต้อง | กรอง action ด้วย canRoleOpen/capability |
| P2 | [global-search.tsx:9](/Users/justkay/Projects/Yogurt_Super_Web/src/components/global-search.tsx:9) | ไม่ตรวจ response.ok และกลืน network error; แสดง “ไม่พบ” หรือผลเก่าราวกับเป็นผลคำค้นล่าสุด | แยก error/empty/loading มี retry และกัน stale results |
| P2 | [store-map.tsx:26](/Users/justkay/Projects/Yogurt_Super_Web/src/components/store-map.tsx:26) | map error เขียน console อย่างเดียว; style/WebGL ล้มเหลวอาจค้าง loading ขณะชิปด้านข้างยังบอกพร้อมใช้ | failed state, retry, จัดการ WebGL init error และคงรายการร้านที่ใช้ต่อได้ |
| P2 | [error.tsx:9](/Users/justkay/Projects/Yogurt_Super_Web/src/app/error.tsx:9) | ข้อความรับรองว่ารายการไม่สำเร็จจะไม่ค้างบันทึก ทั้งที่ error boundary ไม่รู้ว่าคำขอก่อนหน้านั้น commit ไปแล้วหรือไม่ | แนะนำตรวจใบรับเงิน/ยอดล่าสุดก่อนส่งรายการใหม่ และใช้ retry key เดิม |
| P2 | [app-shell.tsx:230](/Users/justkay/Projects/Yogurt_Super_Web/src/components/app-shell.tsx:230) | authenticated shell ไม่มี skip-to-content link ผู้ใช้ keyboard ต้องผ่าน navigation/toolbar ซ้ำ | เพิ่มลิงก์เมื่อ focus ไป main content ที่รับ focus ได้ |
| P2 | [professional.css:1360](/Users/justkay/Projects/Yogurt_Super_Web/src/app/professional.css:1360) | ปุ่มปรับจำนวนบน driver กว้างขั้นต่ำ 38px ชิดกัน; ต่ำกว่าเป้าหมายมือถือ 44px ของ DESIGN.md | เพิ่ม touch target และตรวจบนเครื่องจริง; ไม่ได้กล่าวว่าเป็น WCAG failure จากขนาดนี้อย่างเดียว |

**Rendered QA:** ตรวจ public login ผ่าน browser ประมาณ 1265×712 ภาษา Lao/labels อ่านได้ มี accessible names สำหรับ password visibility และ pause motion; Tab ถึง skip link และ Enter ย้าย focus ไปฟอร์มได้ ไม่ได้กรอกบัญชีจริง

**พื้นฐาน UI ที่ดี:** Noto Sans Lao, `lang="lo"`, category tokens ตาม DESIGN.md, reduced motion, safe areas, skeletons ที่มี status semantics, Radix confirmations และ keyboard-operable section tabs

การตรวจ UI ใช้ [Web Interface Guidelines ปัจจุบัน](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) ร่วมกับ PRODUCT.md/DESIGN.md และ Impeccable context ของ `src/app`; ไม่เปลี่ยนทิศทาง visual design

## 5. งานปฏิบัติการและคุณภาพหลักฐานที่ยังต้องปรับ

### 9) P2 — Health สีเขียวยังไม่สะท้อนความสามารถกู้ระบบ

[health/route.ts:15](/Users/justkay/Projects/Yogurt_Super_Web/src/app/api/health/route.ts:15) เชื่อ `latest.json` และอายุ <=36 ชั่วโมง ไม่ตรวจว่า backup เป็นของ database target ปัจจุบัน งานล่าสุดล้มเหลวหรือไม่ หรือ restore ผ่านหรือไม่ ขณะตรวจ `/api/health` ยังรายงาน `ok` ทั้งที่ backup ล่าสุดใน directory จริงเป็น pre-move local dump และ audit พิสูจน์ว่า Supabase dump กู้ตามขั้นตอนปัจจุบันไม่ได้

ควรแยก app availability กับ backup freshness/target/restore status ให้ชัด และส่ง alert เมื่อมี failure โดยไม่ต้องรอไฟล์เดิมอายุเกิน 36 ชั่วโมง

### 10) P2 — ยังไม่ตั้ง offsite backup และ remote alert

ตรวจเฉพาะว่าค่าถูกตั้งหรือไม่ โดยไม่แสดง secret: `BACKUP_OFFSITE_DIR`, `BACKUP_PASSPHRASE`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ALERT_WEBHOOK_URL` ยัง unset ระบบจึงเก็บ backup ของโครงการไว้บน Mac และแจ้งเตือนผ่าน Mac/log เป็นหลัก

ฐานข้อมูลปัจจุบันอยู่บน Supabase จึงไม่ใช่ทุกอย่างอยู่เครื่องเดียว แต่ยังไม่มีหลักฐานสำเนากู้คืนของ application/receipt files ที่แยกเก็บและผ่านการทดสอบ ควรกำหนดสถานที่เก็บนอกเครื่องและช่องทางแจ้งเหตุที่ผู้ดูแลได้รับจริง

### 11) P2 — Regression test offline ล้าสมัย

[offline-fallback-e2e.mjs:10](/Users/justkay/Projects/Yogurt_Super_Web/tests/offline-fallback-e2e.mjs:10) สร้าง signed session ไม่มี `sid` ซึ่ง auth validator ปัจจุบันบังคับแล้ว การรัน test เดิมจึง fail ที่ `/api/session` ด้วย 401

เมื่อเติม synthetic sid เฉพาะในสำเนาทดสอบ probe ผ่านทั้งหมด นี่คือข้อผิดพลาดของ fixture ไม่ใช่หลักฐานว่า offline fallback ของ product ใช้งานไม่ได้ ควรปรับ fixture และนำ E2E ที่เกี่ยวข้องเข้าชุดตรวจปล่อยเวอร์ชันด้วย

### 12) P2 — Business E2E helper หลังย้ายยังใช้ฐานข้อมูลเดิมบน Mac

[run-business-e2e.sh:10](/Users/justkay/Projects/Yogurt_Super_Web/scripts/run-business-e2e.sh:10) ใช้ `local_database_url` เป็นทั้ง source dump และที่สร้าง scratch database หลังย้ายจะทดสอบสำเนาของ `LOCAL_DATABASE_URL` ไม่ใช่ข้อมูล/schema ต้นทาง Supabase ปัจจุบัน

การใช้ local fixture ปลอดภัยและมีประโยชน์ แต่ไม่ได้พิสูจน์ความเข้ากันได้ของข้อมูล production หลังย้าย ควรแยก configured source กับ scratch target และเพิ่ม test ของ application-only dump จาก Supabase ปัจจุบัน ชุด authenticated tests ยังต้องใช้ test credentials ซึ่งควรสร้างใน clone แทนเก็บรหัสผ่าน admin จริงใน `.env` ถาวร

### 13) P2 — Migration checksums สองรายการไม่ตรงกับไฟล์ที่มีอยู่

เปรียบเทียบ SHA-256 ไฟล์กับ `_prisma_migrations.checksum` พบต่างที่ `20261013140000_auth_sessions_lockout` และ `20261013150000_waste_cost_tracking` ทั้งสองมี finished_at และไม่มี rollback

ตรวจต่อพบ check constraints ที่เพิ่มในไฟล์ปัจจุบันมีอยู่ใน database แล้ว จึง **ไม่ใช่หลักฐานว่าตารางหรือ constraint สำคัญหายไป** ควรตรวจประวัติการแก้ migration/recovery และทำ migration history ให้สืบย้อนกลับได้ โดยไม่ reset ฐานข้อมูลจริง

`prisma migrate diff` แบบอ่านอย่างเดียวพบความต่าง index ของ settlements เท่านั้น ไม่พบ column/table delta ตามที่ Prisma เปรียบเทียบได้ CHECK constraints ได้ตรวจแยกแล้ว Prisma diff เพียงอย่างเดียวไม่ครอบคลุมสิทธิ์ API roles

### 14) P3 — เอกสารสภาพแวดล้อม/ข้อกำหนด design ยังไม่ครบ

README เริ่มด้วยคำอธิบาย production ที่ใช้ PostgreSQL local แม้ runtime เปลี่ยนไป Supabase แล้ว ส่วน `.interface-design/system.md` ที่ AGENTS.md/DESIGN.md อ้างถึงไม่มีอยู่ ควรปรับ runbook ให้ตรงกับระบบจริงและเติม design memory ก่อนทำ UI รอบต่อไป

### 15) ยังรับรอง availability/performance ระยะยาวไม่ได้

เว็บยังรัน Next.js บน Mac ผ่าน Cloudflare tunnel การย้าย DB ไป Supabaseไม่ได้ทำให้ web server พ้นข้อจำกัดการนอนหลับ/ปิดฝา/ไฟฟ้า/เน็ตของ Mac บันทึก health วันนี้มี failed checks แต่ยังไม่เพียงพอคำนวณ uptime ที่น่าเชื่อถือ

`npm run metrics:summary` ใช้งานได้ แต่ sample ต่อ metric/page/build มีน้อย ไม่ควรใช้ percentile เหล่านี้รับรองผู้ใช้จำนวนมาก `/map` มี first-load JS ราว 389kB ใน build ที่ตรวจ ยังไม่ได้ทำ load/soak test หรือทดสอบหลายอุปกรณ์ จึงไม่เสนอจำนวนผู้ใช้พร้อมกันที่รับรองได้

## 6. จุดแข็งที่ควรรักษา

- ธุรกรรม stock/money สำคัญใช้ Serializable transaction และ bounded retry
- Idempotency receipts ผูกกับผู้ใช้ scope และ request body ลดการบันทึกซ้ำเมื่อเครือข่ายขาด
- เงินใช้ exact cents/Decimal; มีการปฏิเสธความละเอียดเกิน การจ่ายเกิน และ stale financial snapshots
- Audit logs ของธุรกรรมสำคัญ commit พร้อม mutation
- Stock validation ป้องกันค่าติดลบ ตรวจตู้/ร้าน/ความจุ และมีต้นทุนระดับ batch/lot
- Integration probe บน PostgreSQL จริงใน clone ยืนยัน FEFO และต้นทุน lot; เมื่อสอง refill แย่งสินค้า 10 ถ้วยโดยขอคนละ 7 ถ้วย มีเพียงหนึ่งรายการสำเร็จ อีกหนึ่งได้ 409 และไม่มี stock/lot/audit ที่ค้างจากรายการแพ้ ส่วน replay ไม่หัก stock ซ้ำ
- Session มี signed HttpOnly cookie, DB session revocation, current-role/active-user checks และ credential invalidation
- มี account lockout, cross-site mutation guards, private receipt storage และตรวจชนิดไฟล์จากเนื้อหา
- `.env` permission 600 และไม่มี `.env`/runtime directory ถูก track ใน Git ตามการตรวจ
- Root `app/` re-export ของ `src/app/` เป็นโครงสร้างตั้งใจ และมี regression ตรวจความครบของ routes

## 7. เกณฑ์ที่ใช้ปิดงานก่อนรับรองพร้อมใช้

1. ปิดช่องทาง Supabase API ที่ไม่ใช้ หรือยืนยันว่าสิทธิ์ anon/authenticated อ่านและแก้ users/การเงินไม่ได้
2. งาน backup หลังย้ายสำเร็จตามตาราง มี metadata ของ target ปัจจุบัน และมี offsite copy ที่กู้ได้
3. Restore backup ล่าสุดและ DR drill ผ่านจนถึงเปิดแอป/ทำธุรกรรมบนสำเนาที่กู้คืน ไม่ใช่เพียง list dump/checksum
4. แก้ daily-closing overwrite, CSV formulas และ concurrent IP rate limiting พร้อม test ยืนยันกรณีผิดเดิม
5. ปรับ offline fixture และเพิ่มการตรวจเส้นทาง backup/recovery ที่ execute จริง
6. ทดสอบ driver flow บนมือถือจริง: นับสินค้า เปลี่ยนยอดเงิน เก็บ draft ออก/กลับหน้า เน็ตหลุดระหว่างบันทึก retry ด้วย key เดิม และตรวจใบรับเงิน
7. ทดสอบการใช้งานจริงรอบสั้นด้วยข้อมูลตั้งต้นที่อนุมัติแล้วก่อนขยายผู้ใช้ พร้อมผู้รับผิดชอบ incident และช่องทางแจ้งเตือนที่ใช้งานได้

## 8. ขอบเขตที่ไม่ได้รับรอง

ไม่ได้ทำ external penetration test, ตรวจ Supabase dashboard/API toggle/provider backup plan, ทดสอบจริงทุกเบราว์เซอร์/โทรศัพท์, load test, soak test, ทดสอบ screen reader ครบทุก flow, deploy/rollback จริง หรือกู้ฐานข้อมูลทับ production ไม่ได้แสดง credentials หรือ password hashes

ผล E2E ผ่านหมายถึง assertion ที่รันบนสำเนาฐานข้อมูล local กับ build ปัจจุบันผ่าน ไม่ได้หมายความว่าทุก workflow และ production integrations ผ่านทั้งหมด
