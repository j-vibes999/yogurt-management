# Yogurt Ops — Consignment Back Office

Next.js + TypeScript back-office MVP for yogurt consignment operations.

## Phase 1 included

- Operations dashboard
- Partner store registry with per-store commission rate
- Fridge asset registry and store assignment
- Mobile-first weekly driver visit list
- Per-store restock/audit flow by flavor
- Live sales reconciliation using the specified formula
- Gross sales, store commission and net payable summary
- Demo-mode draft/completion persistence in browser localStorage
- PostgreSQL-ready Prisma schema covering all requested Phase 1–4 entities

## Core formula

`unitsSold = (previousStock + countRefilled) - countRemaining - countExpiredReturned`

`gross = unitsSold * retailPrice`

`storeCommission = gross * commissionRate`

`netPayable = gross - storeCommission`

The UI blocks closing a visit when any SKU produces negative `unitsSold`, because that indicates a reconciliation discrepancy.

## Run locally

1. Install Node.js 20+ and npm.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.

The Phase 1 UI runs with demo data and does not require a database connection.

## Enable PostgreSQL / Prisma

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Run `npm run prisma:generate`.
3. Create the first migration with `npx prisma migrate dev --name init`.
4. Replace `src/data/demo.ts` reads with Prisma repositories/server actions.

## Key routes

- `/` — operations dashboard
- `/stores` — partner store registry
- `/fridges` — fridge asset registry
- `/driver` — weekly visit list
- `/driver/restock/[storeId]` — mobile audit/restock flow

## Database note

The requested draft schema identified fridge inventory by `store_id`. This implementation also includes `fridge_id` and a unique constraint on `(fridge_id, finished_product_id)` so a store can safely operate more than one fridge without mixing inventory balances.

## Next implementation step

Phase 2 should persist completed visits transactionally, update `fridge_inventory`, create `settlements`, generate the Weekly Consignment Statement, and export the statement to PDF/image for LINE sharing.
