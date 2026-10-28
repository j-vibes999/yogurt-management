# ผลแก้ไขและตรวจหลังอัปเดต Yogurt Super Web

วันที่ 28 ตุลาคม 2026 เวลา 19:05 น. เขต Asia/Vientiane — โค้ดที่ deploy: `3511878f4b47b5da379442f38ea4e61e27c10a11`

**แก้ปัญหาหลักจาก audit และอัปเดตระบบจริงแล้ว เว็บสาธารณะใช้งานได้ แต่ยังไม่รับรองความพร้อม production ครบทุกด้าน: ยังขาดปลายทาง backup นอกเครื่อง ผู้รับแจ้งเตือน และการทดสอบมือถือจริง/โหลดระยะยาว**

รายงานนี้อัปเดตสถานะจาก [audit ก่อนแก้ไข](READINESS_AUDIT_2026-10-28.md) ไม่ได้ลบประวัติผลตรวจเดิม ทดสอบการเขียนธุรกรรมบนฐานข้อมูลสำเนาเท่านั้น ไม่ reset หรือ seed ข้อมูลธุรกิจจริง และไม่เปลี่ยนรหัสผ่านผู้ใช้จริง

## สิ่งที่แก้และเปิดใช้แล้ว

| ข้อจาก audit | การแก้ไข | หลักฐานที่ยืนยัน |
|---|---|---|
| 1 สิทธิ์ Supabase | เพิ่ม migration เปิด RLS และถอนสิทธิ์ client/PUBLIC บนตาราง application รวม default privileges และ helper สำหรับฐานข้อมูลที่ copy ใหม่ | production มี RLS 26/26 ตาราง, ตารางที่ API roles มี table privileges = 0, `anon` และ `authenticated` อ่าน users ไม่ได้; backend อ่านข้อมูลได้ |
| 2–4 Backup/restore/DR | dump เฉพาะ application public objects ไม่รวม provider extensions; ใช้ client ใหม่, bounded retries, checksum, target fingerprint, metadata ต่อ dump และสถานะแยก success/failure; แก้ TMP_URL และ cleanup | backup จาก Supabase จริงกู้ลง PostgreSQL 16 ได้; update หยุดก่อน deploy หาก backup/restore ไม่ผ่าน |
| 5 ปิดยอดรายวัน | GET โหลดค่าของวันที่เลือก; POST ตรวจ expected snapshot ภายใน Serializable/idempotent transaction; UI แยกสร้าง/แก้ไข โหลดก่อนเปิดบันทึก และเก็บค่าระหว่าง error/conflict | route/HTTP tests และ browser clone ยืนยันแก้ `100/200/30` เป็น `110/200/30`; blind/stale edit ได้ 409; replay ไม่สร้างธุรกรรมซ้ำ |
| 6 CSV | generic exporter ใช้ helper ป้องกันสูตรร่วมกับ reports รวม leading whitespace/control characters | regression ผ่านทั้ง formula, Lao, null และตัวเลข |
| 7 Login limit | จอง IP attempt ก่อน async work และไม่ลงโทษซ้ำ | ส่งพร้อมกัน 25 คำขอ: เข้า password work 10 คำขอ อีก 15 ได้ 429; account lockout ยังทำงาน |
| 8 ต้นทุนประวัติ | corrective migration แยกต้นทุนที่รู้จริงจาก unknown โดยอาศัย provenance และเวลา migration | isolated PostgreSQL fixtures ผ่าน รวมต้นทุนศูนย์ที่รู้จริง; ไม่แก้ old migration sources |
| 9 Health | แยก availability กับ local backup/restore readiness; ตรวจ target/age/latest attempt/artifacts และ restore SHA ที่ตรงกัน | production local health: availability/readiness/DB/backup `ok`; public health `status: ok` |
| 11–12 หลักฐาน E2E | แก้ cookie fixture; clone จาก active Supabase และใช้ local URL เฉพาะ scratch; synthetic admin/fixtures เฉพาะ clone | authenticated, business, readiness และ offline suites ผ่าน; guard ไม่ยอมใช้ remote scratch หรือ libpq target overrides |
| 13 Migration history | additive reconciliation ยอมรับเฉพาะ known original hashes หลังตรวจ schema/defaults/constraints/indexes; unknown history abort | production มี 16 migrations และ checksum ตรง source ทั้งหมด; isolated history fixtures ผ่าน |
| 14 เอกสาร | ปรับ README/database/runbook ให้ตรง Supabase; เติม interface system/surface briefs | ดู [คู่มือปฏิบัติการ](docs/OPERATIONS.md) |

หน้าจอ driver autosave ครอบคลุมจำนวนสินค้า ยอดเงิน และวิธีจ่าย ตรวจการเขียน localStorage จริงก่อนบอกว่าเก็บสำเร็จ และรักษา retry key/body เมื่อไม่แน่ใจผลการบันทึก เพิ่ม dialog ก่อนทิ้งค่าบนลิงก์ภายในและ `beforeunload` สำหรับฟอร์มที่ยังมีค่าซึ่งกู้ไม่ได้ รวม live/focused errors, search error/retry/stale-response protection, map failure/retry/list fallback, action ตามสิทธิ์, skip link และ touch targets 44px

พบปัญหาเพิ่มระหว่าง rendered QA: ฟอร์มปิดยอดบน desktop ถูกซ่อนเพราะ disclosure ปิดอยู่แต่ summary ถูกซ่อน จึงเปลี่ยนมาใช้ ResponsiveDisclosure ที่มีอยู่ และตรวจว่าฟอร์มเปิดพร้อมยอดเดิมแล้ว

## ผล deploy และการตรวจระบบจริง

`Apply Yogurt Update.command` ทำงานสำเร็จใน checkout หลัก: tests → backup พร้อม restore → build → migration → start → health/login/access checks โค้ดที่รันและ `.yogurt/deployed-commit` ตรงกับ commit ข้างต้น การ deploy รอบนี้ไม่เกิด rollback; ยังไม่ได้จำลองให้ rollback ของระบบจริงล้มเหลว

ก่อนเริ่มรอบนี้พบ job definitions ของ Yogurt ถูกย้ายไปเก็บไว้ เว็บและ PostgreSQL local ไม่ทำงาน และ public URL ตอบ HTTP 530/Cloudflare 1033 จึงคืน definitions และเปิดบริการที่จำเป็นกลับตาม deployment เดิม ตรวจ tunnel IDs แล้วว่า system Cloudflare daemon เป็นคนละ tunnel จึงเปิดเฉพาะ dedicated `yogurt-manager` กลับ โดยไม่แก้ tunnel อื่นหรือ DNS

สถานะหลังอัปเดต:

- [เว็บสาธารณะ](https://yogurt.bruhgodmod.online/login) และ local `/login` HTTP 200; `/reports` เมื่อไม่ล็อกอิน redirect 307; session/daily-closing API ที่ไม่ล็อกอิน 401
- launchd โหลด server, dedicated tunnel, health ทุก 5 นาที, backup **พร้อม restore ทุกวัน 03:15**, และ weekly restore วันอาทิตย์ 03:45 ตามเวลาเครื่องปัจจุบัน (+07)
- Homebrew PostgreSQL 16 ทำงานอีกครั้งเพื่อ scratch restore; ข้อมูล production ยังคงอยู่บน Supabase
- ใช้ backup `yogurt_ops-20261028-190210-39414.dump` ขนาด 82,459 bytes, SHA-256 `93b8b1f3925597f76e9c99fdb9f85c064305278b937f2c1ee6f915b8f793feaf`
- ตรวจ original restored rows ก่อนใส่ fixture: users 3, stores 0, materials 9, settlements 0, auditLogs 3; ไม่มี receipt files ในชุดนี้ จึงไม่อ้างว่าทดสอบการเปิดภาพใบเสร็จเก่าจาก backup จริงแล้ว
- full DR จาก backup ชุดเดียวกันผ่าน: เปิดแอปบน port 3121, authenticated smoke, business flow, FEFO/expired exclusion/cost snapshots, concurrent replay/stock competition/multi-SKU rollback และ closing conflict; ลบ scratch/server เมื่อจบ

## ผลทดสอบและขอบเขต

| การตรวจ | ผล |
|---|---|
| `npm run verify` ใน worktree แยก | schema, generate, ESLint, TypeScript, 168/168 tests และ production build ผ่าน |
| pre-deploy tests และ build ใน checkout จริง | 168 pass, 0 fail, 0 skip; build ผ่าน |
| `npm run test:e2e:business` | ผ่านบน clone ของ active source |
| `npm run test:e2e:offline` | ผ่าน |
| `npm run db:dr-drill` หลัง deploy | ผ่านจาก production backup ล่าสุด กับ build ที่ deploy จริง |
| `npm audit --json` | registry รายงานช่องโหว่ 0 รายการ ณ เวลาตรวจ; ไม่ใช่ security certification |
| Browser QA บน clone | desktop 1280×720 และ pane มือถือกว้าง 515px: โหลด/แก้ยอดปิดวัน, ยกเลิก discard dialog, draft จำนวน/ยอดเงิน/วิธีจ่ายกู้ได้หลัง reload, แผนที่โหลดและรายการร้านใช้งานได้ |

หลักฐานหน้าจอ: [desktop operations](docs/verification/operations-desktop.png), [mobile closing](docs/verification/closing-mobile.png), [restock draft](docs/verification/restock-draft-mobile.png) เป็นข้อมูลสังเคราะห์ใน clone ไม่ใช่ธุรกรรมจริง

ผล unit tests มีทั้ง behavioral, mock route, isolated PostgreSQL และ source assertions จึงไม่เท่ากับ browser E2E 168 flow ส่วน map/search failure ตรวจ helper/code/tests แต่ไม่ได้บังคับทุก failure ผ่าน browser จริง การเตือนก่อนออกครอบคลุม same-tab links และ `beforeunload`; ยังไม่ครอบคลุม/รับรอง browser Back/Forward ที่เป็น client-side navigation ทุกกรณี

## สิ่งที่ยังต้องทำก่อนรับรองเต็มรูปแบบ

1. **ข้อ 10: Backup นอกเครื่องและ remote alerts** — ยังไม่ได้รับปลายทาง/ผู้รับจากผู้ใช้ `latest.json` ระบุ `offsite: false` มี integration tests สำหรับการ copy/checksum/เข้ารหัส แต่ยังไม่มีหลักฐานส่งไปปลายทางจริงและกู้กลับจากปลายทางนั้น ห้ามตีความ health สีเขียวว่า offsite/remote alerts ตั้งค่าครบแล้ว
2. **ข้อ 15: availability/performance** — เว็บยังพึ่ง Mac/ไฟ/อินเทอร์เน็ต/ฝาเครื่อง/การล็อกอิน user เพื่อเริ่ม LaunchAgents ไม่มี measured capacity หรือ SLA; ยังไม่ได้ load/soak test หรือย้าย web hosting
3. ทดสอบ driver ครบรอบบนโทรศัพท์จริง รวมขาดเน็ตระหว่างส่ง, retry/receipt, การกลับหน้า และ storage failure; ยังไม่ได้ทำ full screen-reader/cross-browser audit
4. ก่อนเริ่มใช้งานธุรกิจ ให้ผู้รับผิดชอบกรอกและตรวจร้าน ตู้ และยอดตั้งต้นที่อนุมัติแล้ว ฐานข้อมูลจริงยังไม่มีร้าน/settlement; ไม่ได้นำ test fixtures ไปเป็นข้อมูลเริ่มต้น

ไม่พบ blocker เดิมด้าน code/security/local recovery คงค้างจากกรณีที่ตรวจแล้ว แต่รายการภายนอกและขอบเขตข้างต้นยังไม่ปิด จึงเหมาะกับการทดสอบใช้งานแบบควบคุมก่อนขยายผู้ใช้

Logs/metadata ที่ไม่เข้า Git: `.yogurt/update.log`, `update-tests.log`, `update-backup.log`, `hardening-verify.log`, `hardening-production-dr.log`, `backups/*.json` และ `.yogurt/recovery/readiness-deploy/database-check.json` เก็บ backup ก่อน release และหลักฐานรอบก่อนหน้าไว้ใน `.yogurt/recovery/readiness-deploy/pre-release/` ด้วย
