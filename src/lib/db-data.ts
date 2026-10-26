import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { businessDateString, businessReportRange, parseDateOnly } from "@/lib/date-only";
import { refilledSinceAudit } from "@/lib/refill-summary";
import {
  demoFridges,
  demoInventory,
  demoProducts,
  demoSettlements,
  demoStores,
  monthlyExpenses,
  rawMaterials,
  refillRequests,
  weeklyVisitStatus,
} from "@/data/demo";

export type DataSource = "database" | "demo";
export type FridgeStatusView = "active" | "maintenance";

export type StoreView = {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  facebook: string;
  address: string;
  commissionRate: number;
  fridgeStartDate: string;
  latitude: number | null;
  longitude: number | null;
  monthlyElectricity: number;
  fridge: {
    id: string;
    assetCode: string;
    model: string;
    serialNo: string;
    capacityCups: number;
    status: FridgeStatusView;
  } | null;
  stock: number;
  due: boolean;
};

export type SettlementView = {
  id: string;
  storeId: string;
  storeName: string;
  periodLabel: string;
  cheeseSold: number;
  mangoSold: number;
  productSales: { productId:string; code:string; name:string; unitsSold:number }[];
  gross: number;
  commission: number;
  net: number;
  paid: number;
  closingBalance: number;
  cogs: number;
  status: "paid" | "partial" | "pending";
};

export type RefillView = {
  id: string;
  storeId: string;
  storeName: string;
  address: string;
  phone: string;
  status: "waiting" | "preparing" | "delivering" | "completed" | "cancelled";
  cheeseQty: number;
  mangoQty: number;
  items: { productId: string; code: string; name: string; quantity: number }[];
  requestedAt: string;
  note?: string;
};

export type MaterialView = {
  id: string;
  code: string;
  name: string;
  category: "ingredient" | "packaging";
  unit: string;
  stock: number;
  minStock: number;
  avgCost: number;
};

export type ExpenseView = {
  id: string;
  label: string;
  category: string;
  amount: number;
  incurredAt: string;
  incurredAtIso: string;
  storeId: string | null;
  storeName: string | null;
  note: string | null;
  receiptUrl: string | null;
};

export type FridgeView = {
  id: string;
  assetCode: string;
  model: string;
  serialNo: string;
  capacityCups: number;
  status: FridgeStatusView;
  storeId: string | null;
  storeName: string;
  stockTotal: number;
};

export type RestockStoreData = {
  store: { id: string; name: string; address: string; phone: string; whatsapp?: string; latitude: number | null; longitude: number | null; commissionRate: number };
  fridge: { assetCode: string };
  previousBalance: number;
  lines: Array<{
    productId: string;
    name: string;
    color: string;
    retailPrice: number;
    previousStock: number;
    refilledSinceAudit: number;
  }>;
};

export type DashboardData = {
  source: DataSource;
  stores: StoreView[];
  settlements: SettlementView[];
  refills: RefillView[];
  lowMaterials: MaterialView[];
  weeklyGross: number;
  ownerNet: number;
  outstanding: number;
  cupsInStores: number;
  dueStores: number;
  totalCapacity: number;
};

export type ReportStoreRow = {
  storeId: string;
  storeName: string;
  gross: number;
  storeShare: number;
  electricity: number;
  transport: number;
  otherExpenses: number;
  expenseTotal: number;
  electricityBudget: number;
  productCost: number;
  wasteCost: number;
  profit: number;
};

export type ProductionBatchView = {
  id: string;
  batchNumber: string;
  productId: string;
  productName: string;
  quantityProduced: number;
  quantityRemaining: number;
  totalMaterialCost: number;
  unitCost: number;
  costKnown: boolean;
  mfgDate: string;
  expDate: string;
  daysToExpiry: number;
};

export type ProductionProductView = {
  id: string;
  code: string;
  name: string;
  centralStock: number;
  shelfLifeDays: number;
};

export type ProductionData = {
  source: DataSource;
  products: ProductionProductView[];
  batches: ProductionBatchView[];
  adjustmentBatches: ProductionBatchView[];
  totalBatches: number;
  pageCount: number;
  historyPage: number | null;
  centralStockTotal: number;
};

export type NotificationView = { id: string; type: "urgent" | "warning" | "info"; title: string; detail: string; href: string };

export type ReportsData = {
  source: DataSource;
  monthGross: number;
  storeShare: number;
  expenses: number;
  productCost: number;
  /** Expired or damaged cups returned from fridges, plus write-offs at the central stock. */
  wasteCost: number;
  storeWasteCost: number;
  centralWasteCost: number;
  wasteUnits: number;
  costMode: "actual" | "estimated";
  netProfit: number;
  unallocatedExpenses: number;
  electricityBudget: number;
  weeklyGross: number;
  cheeseSold: number;
  mangoSold: number;
  productSales: { productId:string; code:string; name:string; unitsSold:number }[];
  storeRows: ReportStoreRow[];
};

const n = (value: unknown) => Number(value ?? 0);
const moneyValue = (value: number) => new Prisma.Decimal(value).toDecimalPlaces(2).toNumber();
const dateText = (value: Date | string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("lo-LA", { timeZone: "Asia/Vientiane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value))
    : "—";
const dateTimeText = (value: Date | string) =>
  new Intl.DateTimeFormat("lo-LA", { timeZone: "Asia/Vientiane", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const period = (value: Date) =>
  new Intl.DateTimeFormat("lo-LA", { timeZone: "Asia/Vientiane", day: "2-digit", month: "short", year: "numeric" }).format(value);
const isCheese = (code: string, name: string) => /CHS|cheese|ຊີສ/i.test(`${code} ${name}`);
const isMango = (code: string, name: string) => /MNG|mango|ໝາກມ່ວງ/i.test(`${code} ${name}`);
const productColor = (code: string, name: string) => isCheese(code, name) ? "#f2c94c" : isMango(code, name) ? "#f2994a" : "#8aa39a";
const sevenDaysAgo = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

function demoStoresView(): StoreView[] {
  return demoStores.map((store, index) => {
    const fridge = demoFridges[index];
    return {
      id: store.id,
      name: store.name,
      contactName: store.contactName,
      phone: store.phone,
      whatsapp: store.whatsapp,
      facebook: store.facebook,
      address: store.address,
      commissionRate: store.commissionRate,
      fridgeStartDate: store.fridgeStartDate,
      latitude: store.latitude,
      longitude: store.longitude,
      monthlyElectricity: 200000,
      fridge: fridge ? {
        id: fridge.id,
        assetCode: fridge.assetCode,
        model: fridge.model,
        serialNo: fridge.serialNo,
        capacityCups: 100,
        status: fridge.status,
      } : null,
      stock: demoInventory.filter((line) => line.storeId === store.id).reduce((sum, line) => sum + line.currentStock, 0),
      due: weeklyVisitStatus[store.id] === "pending",
    };
  });
}

function demoSettlementView(): SettlementView[] {
  return demoSettlements.map((item) => ({
    id: item.id,
    storeId: item.storeId,
    storeName: demoStores.find((store) => store.id === item.storeId)?.name ?? "—",
    periodLabel: item.periodLabel,
    cheeseSold: item.cheeseSold,
    mangoSold: item.mangoSold,
    productSales: [
      {productId:"p-cheese",code:"YG-CHS-74",name:"ນົມຊີສ",unitsSold:item.cheeseSold},
      {productId:"p-mango",code:"YG-MNG-74",name:"ໝາກມ່ວງ",unitsSold:item.mangoSold},
    ].filter(x=>x.unitsSold>0),
    gross: item.gross,
    commission: item.commission,
    net: item.net,
    paid: item.paid,
    closingBalance: Math.max(0, item.net - item.paid),
    cogs: item.gross * 0.28,
    status: item.status,
  }));
}

function demoRefillView(): RefillView[] {
  return refillRequests.map((item) => {
    const store = demoStores.find((value) => value.id === item.storeId);
    return {
      id: item.id,
      storeId: item.storeId,
      storeName: store?.name ?? "—",
      address: store?.address ?? "—",
      phone: store?.phone ?? "—",
      status: item.status,
      cheeseQty: item.cheeseQty,
      mangoQty: item.mangoQty,
      items: [
        { productId: "p-cheese", code: "YG-CHS-74", name: "ນົມຊີສ", quantity: item.cheeseQty },
        { productId: "p-mango", code: "YG-MNG-74", name: "ໝາກມ່ວງ", quantity: item.mangoQty },
      ].filter((line) => line.quantity > 0),
      requestedAt: dateTimeText(item.requestedAt),
      note: item.note,
    };
  });
}

function demoMaterialView(): MaterialView[] {
  return rawMaterials.map((item) => ({
    id: item.id,
    code: item.id,
    name: item.name,
    category: item.category,
    unit: item.unit,
    stock: item.stock,
    minStock: item.minStock,
    avgCost: item.avgCost,
  }));
}

function demoExpenseView(): ExpenseView[] {
  return monthlyExpenses.map((item, index) => ({
    id: `demo-expense-${index + 1}`,
    label: item.label,
    category: item.category,
    amount: item.amount,
    incurredAt: "ກັນຍາ 2026",
    incurredAtIso: "2026-09-01",
    storeId: null,
    storeName: null,
    note: index === 0 ? "200,000 LAK/ຮ້ານ/ເດືອນ" : null,
    receiptUrl: null,
  }));
}

function demoFridgeView(): FridgeView[] {
  return demoFridges.map((fridge) => ({
    id: fridge.id,
    assetCode: fridge.assetCode,
    model: fridge.model,
    serialNo: fridge.serialNo,
    capacityCups: 100,
    status: fridge.status,
    storeId: fridge.storeId,
    storeName: demoStores.find((store) => store.id === fridge.storeId)?.name ?? "—",
    stockTotal: demoInventory.filter((item)=>item.storeId===fridge.storeId).reduce((sum,item)=>sum+item.currentStock,0),
  }));
}

function demoRestockStoreData(storeId: string): RestockStoreData | null {
  const store = demoStores.find((item) => item.id === storeId);
  const fridge = demoFridges.find((item) => item.storeId === storeId);
  if (!store || !fridge) return null;
  const lines = demoInventory.filter((item) => item.storeId === storeId).map((item) => {
    const product = demoProducts.find((value) => value.id === item.productId)!;
    return {
      productId: item.productId,
      name: product.name,
      color: product.color,
      retailPrice: product.retailPrice,
      previousStock: item.currentStock,
      refilledSinceAudit: 0,
    };
  });
  return {
    store: { id: store.id, name: store.name, address: store.address, phone: store.phone, whatsapp: store.whatsapp, latitude: store.latitude, longitude: store.longitude, commissionRate: store.commissionRate },
    fridge: { assetCode: fridge.assetCode },
    previousBalance: demoSettlementView().filter((x)=>x.storeId===storeId)[0]?.closingBalance ?? 0,
    lines,
  };
}

let dbHealth: { ok: boolean; expiresAt: number } | null = null;
let dbHealthPromise: Promise<boolean> | null = null;

async function canUseDatabase() {
  if (!process.env.DATABASE_URL) return false;
  const now = Date.now();
  if (dbHealth && dbHealth.expiresAt > now) return dbHealth.ok;
  if (dbHealthPromise) return dbHealthPromise;

  dbHealthPromise = (async () => {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      dbHealth = { ok: true, expiresAt: Date.now() + 10_000 };
      return true;
    } catch (error) {
      console.warn("[yogurt-db] database unavailable; using demo fallback", error);
      dbHealth = { ok: false, expiresAt: Date.now() + 2_000 };
      return false;
    } finally {
      dbHealthPromise = null;
    }
  })();
  return dbHealthPromise;
}

async function latestStoreState() {
  const rows = await prisma.$queryRaw<Array<{ id: string; visit_date: Date | null; refill_status: string | null; closing_balance: unknown }>>`
    SELECT s.id, v.visit_date, r.status AS refill_status, st.closing_balance
    FROM stores s
    LEFT JOIN LATERAL (SELECT visit_date FROM restock_visits WHERE store_id=s.id AND status='completed' ORDER BY visit_date DESC LIMIT 1) v ON true
    LEFT JOIN LATERAL (SELECT status FROM refill_requests WHERE store_id=s.id AND status IN ('waiting','preparing','delivering') ORDER BY requested_at DESC, id DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL (SELECT closing_balance FROM settlements WHERE store_id=s.id ORDER BY settlement_date DESC, id DESC LIMIT 1) st ON true
    WHERE s.is_active=true
  `;
  return new Map(rows.map(row => [row.id, row]));
}

async function dbStores(): Promise<StoreView[]> {
  const [rows, latest] = await Promise.all([prisma.store.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      fridge: true,
      fridgeInventory: true,
    },
  }), latestStoreState()]);
  const cutoff = sevenDaysAgo();
  return rows.map((store) => ({
    id: store.id,
    name: store.name,
    contactName: store.contactName ?? "—",
    phone: store.phone ?? "—",
    whatsapp: store.whatsapp ?? "—",
    facebook: store.facebook ?? "—",
    address: store.address ?? "—",
    commissionRate: n(store.commissionRate),
    fridgeStartDate: dateText(store.fridgeStartDate),
    latitude: store.latitude === null ? null : n(store.latitude),
    longitude: store.longitude === null ? null : n(store.longitude),
    monthlyElectricity: n(store.monthlyElectricity),
    fridge: store.fridge ? {
      id: store.fridge.id,
      assetCode: store.fridge.assetCode,
      model: store.fridge.model ?? "—",
      serialNo: store.fridge.serialNo ?? "—",
      capacityCups: store.fridge.capacityCups,
      status: store.fridge.status,
    } : null,
    // currentStock is live: completed refills are already applied to fridge inventory.
    // A store's stock is the stock of the fridge that stands in it now, not rows a moved fridge left behind.
    stock: store.fridgeInventory.filter((item) => item.fridgeId === store.fridge?.id).reduce((sum, item) => sum + item.currentStock, 0),
    due: !latest.get(store.id)?.visit_date || latest.get(store.id)!.visit_date! < cutoff,
  }));
}

async function dbSettlements(range?: { from?: Date; to?: Date; take?: number; skip?: number; where?: Prisma.SettlementWhereInput }): Promise<SettlementView[]> {
  const rows = await prisma.settlement.findMany({
    where: { ...range?.where, ...(range?.from || range?.to ? { settlementDate: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } } : {}) },
    orderBy: [{ settlementDate: "desc" }, { id: "desc" }],
    ...(range?.take ? { take: range.take } : {}),
    ...(range?.skip ? { skip: range.skip } : {}),
    include: {
      store: true,
      restockVisit: { include: { items: { include: { finishedProduct: true } } } },
    },
  });
  return rows.map((item) => {
    let cheeseSold = 0;
    let mangoSold = 0;
    let cogs = 0;
    for (const line of item.restockVisit.items) {
      if (isCheese(line.finishedProduct.code, line.finishedProduct.name)) cheeseSold += line.unitsSold;
      else if (isMango(line.finishedProduct.code, line.finishedProduct.name)) mangoSold += line.unitsSold;
      cogs += n((line as unknown as { subtotalCost?: unknown }).subtotalCost);
    }
    const productSales = item.restockVisit.items.map(line=>({productId:line.finishedProductId,code:line.finishedProduct.code,name:line.finishedProduct.name,unitsSold:line.unitsSold})).filter(x=>x.unitsSold>0);
    return {
      id: item.receiptNumber ?? item.id,
      storeId: item.storeId,
      storeName: item.store.name,
      periodLabel: period(item.settlementDate),
      cheeseSold,
      mangoSold,
      productSales,
      gross: n(item.grossAmount),
      commission: n(item.storeCommissionAmount),
      net: n(item.netPayableAmount),
      paid: n(item.paidAmount),
      closingBalance: n(item.closingBalance),
      cogs,
      status: item.paymentStatus,
    };
  });
}

async function dbRefills(activeOnly = true): Promise<RefillView[]> {
  const rows = await prisma.refillRequest.findMany({
    where: activeOnly ? { status: { in: ["waiting", "preparing", "delivering"] } } : undefined,
    orderBy: { requestedAt: "asc" },
    include: { store: true, items: { include: { finishedProduct: true } } },
  });
  return rows.map((item) => {
    let cheeseQty = 0;
    let mangoQty = 0;
    for (const line of item.items) {
      if (isCheese(line.finishedProduct.code, line.finishedProduct.name)) cheeseQty += line.quantity;
      else if (isMango(line.finishedProduct.code, line.finishedProduct.name)) mangoQty += line.quantity;
    }
    return {
      id: item.id,
      storeId: item.storeId,
      storeName: item.store.name,
      address: item.store.address ?? "—",
      phone: item.store.phone ?? "—",
      status: item.status,
      cheeseQty,
      mangoQty,
      items: item.items.map((line) => ({ productId: line.finishedProductId, code: line.finishedProduct.code, name: line.finishedProduct.name, quantity: line.quantity })),
      requestedAt: dateTimeText(item.requestedAt),
      note: item.note ?? undefined,
    };
  });
}

async function dbMaterials(): Promise<MaterialView[]> {
  const rows = await prisma.rawMaterial.findMany({ where:{isActive:true}, orderBy: { name: "asc" } });
  return rows.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category,
    unit: item.unit,
    stock: n(item.currentStock),
    minStock: n(item.minStockAlert),
    avgCost: n(item.avgCostPerUnit),
  }));
}

function expenseView(item: { id:string;storeId:string|null;category:string;amount:unknown;incurredAt:Date;note:string|null;receiptUrl:string|null;store:{name:string}|null }): ExpenseView {
  return { id:item.id,label:item.note||item.category,category:item.category,amount:n(item.amount),incurredAt:dateText(item.incurredAt),incurredAtIso:businessDateString(item.incurredAt),storeId:item.storeId,storeName:item.store?.name??null,note:item.note,receiptUrl:item.receiptUrl };
}
async function dbExpenses(where: Prisma.ExpenseWhereInput, page: number): Promise<ExpenseView[]> {
  const rows=await prisma.expense.findMany({where,orderBy:[{incurredAt:"desc"},{id:"desc"}],take:50,skip:(page-1)*50,include:{store:{select:{name:true}}}});
  return rows.map(expenseView);
}
export async function expenseFilter(options?: {query?:string;filter?:string;id?:string}): Promise<Prisma.ExpenseWhereInput> {
  const q=(options?.query??"").trim().slice(0,200); const filter=options?.filter??"all";
  const categories:Record<string,string[]>={electricity:["electricity","ຄ່າໄຟ","ຄ່າໄຟຟ້າ"],transport:["transport","fuel","ຄ່າຂົນສົ່ງ","ຄ່ານ້ຳມັນ"],maintenance:["maintenance","ຄ່າສ້ອມແປງ"]};
  const month=businessReportRange("month");
  const matchingCategories = categories[filter] ? (await prisma.$queryRaw<Array<{category:string}>>`SELECT DISTINCT category FROM expenses WHERE LOWER(BTRIM(category)) IN (${Prisma.join(categories[filter])})`).map(row=>row.category) : null;
  return {voidedAt:null,...(options?.id?{id:options.id}:{}),...(filter==="month"?{incurredAt:{gte:month.from,lt:month.to}}:{}),...(matchingCategories?{category:{in:matchingCategories}}:{}),...(q?{OR:[{category:{contains:q,mode:"insensitive"}},{note:{contains:q,mode:"insensitive"}},{store:{name:{contains:q,mode:"insensitive"}}}]}:{})};
}

export async function getStoreOptions() {
  if (!(await canUseDatabase())) return {source:"demo" as const,stores:demoStoresView().map(({id,name})=>({id,name}))};
  try { return {source:"database" as const,stores:await prisma.store.findMany({where:{isActive:true},orderBy:{name:"asc"},select:{id:true,name:true}})}; }
  catch { return {source:"demo" as const,stores:demoStoresView().map(({id,name})=>({id,name}))}; }
}

async function dbFridges(): Promise<FridgeView[]> {
  const rows = await prisma.fridge.findMany({ orderBy: { assetCode: "asc" }, include: { currentStore: true, inventory: true } });
  return rows.map((fridge) => ({
    id: fridge.id,
    assetCode: fridge.assetCode,
    model: fridge.model ?? "—",
    serialNo: fridge.serialNo ?? "—",
    capacityCups: fridge.capacityCups,
    status: fridge.status,
    storeId: fridge.currentStoreId,
    storeName: fridge.currentStore?.name ?? "ຍັງບໍ່ຕິດຕັ້ງ",
    stockTotal: fridge.inventory.reduce((sum,row)=>sum+row.currentStock,0),
  }));
}

function currentOutstanding(settlements: SettlementView[]) {
  const seen = new Set<string>();
  let total = 0;
  for (const item of settlements) {
    if (seen.has(item.storeId)) continue;
    seen.add(item.storeId);
    total += item.closingBalance;
  }
  return total;
}

async function dbCurrentOutstanding(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ closing_balance: unknown }>>`
    SELECT DISTINCT ON (store_id) closing_balance
    FROM settlements
    ORDER BY store_id, settlement_date DESC, id DESC
  `;
  return rows.reduce((sum, row) => sum + n(row.closing_balance), 0);
}

// Prisma stores DateTime columns as UTC timestamp values; normalize raw-query bounds explicitly.
async function dbWeeklySettlementSummary(from: Date): Promise<{ gross:number; net:number }> {
  const rows = await prisma.$queryRaw<Array<{ gross: unknown; net: unknown }>>`
    SELECT COALESCE(SUM(gross_amount),0) AS gross, COALESCE(SUM(net_payable_amount),0) AS net
    FROM settlements
    WHERE settlement_date >= (${from}::timestamptz AT TIME ZONE 'UTC')
  `;
  return { gross:n(rows[0]?.gross), net:n(rows[0]?.net) };
}

function fallbackDashboard(): DashboardData {
  const stores = demoStoresView();
  const settlements = demoSettlementView();
  const refills = demoRefillView().filter((item) => item.status !== "completed" && item.status !== "cancelled");
  const lowMaterials = demoMaterialView().filter((item) => item.stock <= item.minStock * 1.5);
  return {
    source: "demo",
    stores,
    settlements,
    refills,
    lowMaterials,
    weeklyGross: settlements.reduce((sum, item) => sum + item.gross, 0),
    ownerNet: settlements.reduce((sum, item) => sum + item.net, 0),
    outstanding: currentOutstanding(settlements),
    cupsInStores: stores.reduce((sum, item) => sum + item.stock, 0),
    dueStores: stores.filter((item) => item.due).length,
    totalCapacity: stores.reduce((sum, item) => sum + (item.fridge?.capacityCups ?? 0), 0),
  };
}

export async function getStoresData() {
  if (!(await canUseDatabase())) return { source: "demo" as const, stores: demoStoresView() };
  try { return { source: "database" as const, stores: await dbStores() }; }
  catch (error) { console.error("[yogurt-db] stores query failed", error); return { source: "demo" as const, stores: demoStoresView() }; }
}

export async function getSettlementsData(options?: {page?:number;query?:string;filter?:string}) {
  const query=(options?.query??"").trim().slice(0,200); const filter=["pending","partial","paid","all"].includes(options?.filter??"")?options!.filter!:"pending";
  const fallback=()=>{const settlements=demoSettlementView(); const latest=settlements.filter((x,i)=>settlements.findIndex(y=>y.storeId===x.storeId)===i); return {source:"demo" as const,settlements,currentOutstanding:currentOutstanding(settlements),collected:settlements.reduce((sum,x)=>sum+x.paid,0),pendingStores:latest.filter(x=>x.closingBalance>0).length,server:undefined};};
  if (!(await canUseDatabase())) return fallback();
  try {
    const latest=await prisma.$queryRaw<Array<{id:string;closing_balance:unknown;payment_status:string}>>`SELECT DISTINCT ON(store_id) id,closing_balance,payment_status FROM settlements ORDER BY store_id,settlement_date DESC,id DESC`;
    const counts={pending:latest.filter(x=>n(x.closing_balance)>0).length,partial:latest.filter(x=>x.payment_status==="partial").length,paid:latest.filter(x=>n(x.closing_balance)<=0).length,all:0};
    const queryDate=parseDateOnly(query);const queryRange=queryDate?businessReportRange("today",queryDate):null;
    const where: Prisma.SettlementWhereInput={...(filter!=="all"?{id:{in:latest.map(x=>x.id)}}:{}),...(filter==="pending"?{closingBalance:{gt:0}}:filter==="partial"?{paymentStatus:"partial"}:filter==="paid"?{closingBalance:{lte:0}}:{}),...(query?{OR:[{receiptNumber:{contains:query,mode:"insensitive"}},{store:{name:{contains:query,mode:"insensitive"}}},...(queryRange?[{settlementDate:{gte:queryRange.from,lt:queryRange.to}}]:[])]}:{})};
    const [total,allCount,summary]=await Promise.all([prisma.settlement.count({where}),prisma.settlement.count(),prisma.settlement.aggregate({_sum:{paidAmount:true}})]);
    counts.all=allCount;
    const page=Math.min(Math.max(1,Math.trunc(options?.page||1)),Math.max(1,Math.ceil(total/50)));
    const settlements=await dbSettlements({where,take:50,skip:(page-1)*50});
    return {source:"database" as const,settlements,currentOutstanding:latest.reduce((sum,x)=>sum+n(x.closing_balance),0),collected:n(summary._sum.paidAmount),pendingStores:counts.pending,server:{page,pageCount:Math.max(1,Math.ceil(total/50)),total,query,filter,counts}};
  } catch(error){console.error("[yogurt-db] settlements query failed",error);return fallback();}
}

export async function getRefillsData() {
  if (!(await canUseDatabase())) return { source: "demo" as const, refills: demoRefillView().filter((item) => item.status !== "completed") };
  try { return { source: "database" as const, refills: await dbRefills(true) }; }
  catch (error) { console.error("[yogurt-db] refills query failed", error); return { source: "demo" as const, refills: demoRefillView().filter((item) => item.status !== "completed") }; }
}

export async function getInventoryData() {
  if (!(await canUseDatabase())) return { source: "demo" as const, materials: demoMaterialView() };
  try { return { source: "database" as const, materials: await dbMaterials() }; }
  catch (error) { console.error("[yogurt-db] inventory query failed", error); return { source: "demo" as const, materials: demoMaterialView() }; }
}

export async function getExpensesData(options?: {page?:number;query?:string;filter?:string;id?:string}) {
  const query=(options?.query??"").trim().slice(0,200);const filter=["all","month","electricity","transport","maintenance"].includes(options?.filter??"")?options!.filter!:"all";
  const fallback=()=>{const expenses=demoExpenseView().filter(x=>!options?.id||x.id===options.id);return {source:"demo" as const,expenses,totalAmount:expenses.reduce((sum,x)=>sum+x.amount,0),total:expenses.length,server:undefined};};
  if (!(await canUseDatabase())) return fallback();
  try {
    const where=await expenseFilter({...options,query,filter});
    const [total,summary]=await Promise.all([prisma.expense.count({where}),prisma.expense.aggregate({where,_sum:{amount:true}})]);
    const page=Math.min(Math.max(1,Math.trunc(options?.page||1)),Math.max(1,Math.ceil(total/50)));
    return {source:"database" as const,expenses:await dbExpenses(where,page),totalAmount:n(summary._sum.amount),total,server:{page,pageCount:Math.max(1,Math.ceil(total/50)),total,query,filter}};
  }catch(error){console.error("[yogurt-db] expenses query failed",error);return fallback();}
}

export async function getFridgesData() {
  if (!(await canUseDatabase())) return { source: "demo" as const, fridges: demoFridgeView() };
  try { return { source: "database" as const, fridges: await dbFridges() }; }
  catch (error) { console.error("[yogurt-db] fridges query failed", error); return { source: "demo" as const, fridges: demoFridgeView() }; }
}

export async function getMapData() {
  if (!(await canUseDatabase())) {
    const { stores } = await getStoresData();
    return {
      source: "demo" as DataSource,
      stores: stores.filter((store) => store.latitude !== null && store.longitude !== null).map((store) => ({
        id: store.id,
        name: store.name,
        address: store.address,
        latitude: store.latitude!,
        longitude: store.longitude!,
        stock: store.stock,
        capacity: store.fridge?.capacityCups ?? 100,
        due: store.due,
        lowStock: (store.fridge?.capacityCups ?? 100) > 0 ? store.stock / (store.fridge?.capacityCups ?? 100) <= 0.35 : false,
        fridgeStatus: (store.fridge?.status ?? "active") as "active" | "maintenance",
        assetCode: store.fridge?.assetCode ?? "—",
        refillStatus: null as "waiting" | "preparing" | "delivering" | null,
        outstanding: 0,
        contactName: store.contactName,
        phone: store.phone,
        whatsapp: store.whatsapp,
        fridgeNumber: store.fridge?.assetCode ?? "—",
        yogurt: [{ name: "Yogurt", quantity: store.stock }],
      })),
    };
  }

  try {
    const cutoff = sevenDaysAgo();
    const [rows, latest] = await Promise.all([prisma.store.findMany({
      where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        contactName: true,
        phone: true,
        whatsapp: true,
        fridge: { select: { id: true, assetCode: true, capacityCups: true, status: true } },
        fridgeInventory: { select: { fridgeId: true, currentStock: true, finishedProduct: { select: { name: true } } } },
      },
    }), latestStoreState()]);

    return {
      source: "database" as DataSource,
      stores: rows.map((store) => {
        const inventory = store.fridgeInventory.filter((item) => item.fridgeId === store.fridge?.id);
        const stock = inventory.reduce((sum, item) => sum + item.currentStock, 0);
        const capacity = store.fridge?.capacityCups ?? 100;
        const status = latest.get(store.id)?.refill_status;
        return {
          id: store.id,
          name: store.name,
          address: store.address ?? "—",
          latitude: n(store.latitude),
          longitude: n(store.longitude),
          stock,
          capacity,
          due: !latest.get(store.id)?.visit_date || latest.get(store.id)!.visit_date! < cutoff,
          lowStock: capacity > 0 ? stock / capacity <= 0.35 : false,
          fridgeStatus: (store.fridge?.status ?? "active") as "active" | "maintenance",
          assetCode: store.fridge?.assetCode ?? "—",
          refillStatus: status === "waiting" || status === "preparing" || status === "delivering" ? status as "waiting" | "preparing" | "delivering" : null,
          outstanding: n(latest.get(store.id)?.closing_balance),
          contactName: store.contactName ?? "—",
          phone: store.phone ?? "—",
          whatsapp: store.whatsapp ?? "—",
          fridgeNumber: store.fridge?.assetCode ?? "—",
          yogurt: inventory.map((item) => ({ name: item.finishedProduct.name, quantity: item.currentStock })),
        };
      }),
    };
  } catch (error) {
    console.error("[yogurt-db] map query failed", error);
    const { stores } = await getStoresData();
    return {
      source: "demo" as DataSource,
      stores: stores.filter((store) => store.latitude !== null && store.longitude !== null).map((store) => ({
        id: store.id, name: store.name, address: store.address, latitude: store.latitude!, longitude: store.longitude!,
        stock: store.stock, capacity: store.fridge?.capacityCups ?? 100, due: store.due,
        lowStock: (store.fridge?.capacityCups ?? 100) > 0 ? store.stock / (store.fridge?.capacityCups ?? 100) <= 0.35 : false,
        fridgeStatus: (store.fridge?.status ?? "active") as "active" | "maintenance", assetCode: store.fridge?.assetCode ?? "—",
        refillStatus: null as "waiting" | "preparing" | "delivering" | null, outstanding: 0,
        contactName: store.contactName, phone: store.phone, whatsapp: store.whatsapp, fridgeNumber: store.fridge?.assetCode ?? "—",
        yogurt: [{ name: "Yogurt", quantity: store.stock }],
      })),
    };
  }
}

export async function getRestockStoreData(storeId: string): Promise<{ source: DataSource; data: RestockStoreData | null }> {
  if (!(await canUseDatabase())) return { source: "demo", data: demoRestockStoreData(storeId) };
  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: {
        fridge: true,
        // Same rows the audit API counts: only the fridge that stands in this store now (F04).
        fridgeInventory: { where: { fridge: { currentStoreId: storeId } }, include: { finishedProduct: true } },
        settlements: { orderBy: [{ settlementDate: "desc" }, { id: "desc" }], take: 1, select: { closingBalance: true } },
      },
    });
    if (!store || !store.fridge) return { source: "database", data: null };
    const refillCounts = await refilledSinceAudit(storeId);
    return {
      source: "database",
      data: {
        store: { id: store.id, name: store.name, address: store.address ?? "—", phone: store.phone ?? "", whatsapp: store.whatsapp ?? "", latitude: store.latitude === null ? null : n(store.latitude), longitude: store.longitude === null ? null : n(store.longitude), commissionRate: n(store.commissionRate) },
        fridge: { assetCode: store.fridge.assetCode },
        previousBalance: n(store.settlements[0]?.closingBalance),
        lines: store.fridgeInventory.map((line) => {
          const refilledCount = refillCounts.get(line.finishedProductId) ?? 0;
          return {
            productId: line.finishedProductId,
            name: line.finishedProduct.name,
            color: productColor(line.finishedProduct.code, line.finishedProduct.name),
            retailPrice: n(line.finishedProduct.retailPrice),
            previousStock: line.currentStock,
            refilledSinceAudit: refilledCount,
          };
        }),
      },
    };
  } catch (error) {
    console.error("[yogurt-db] restock store query failed", error);
    return { source: "demo", data: demoRestockStoreData(storeId) };
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  if (!(await canUseDatabase())) return fallbackDashboard();
  try {
    const weekStart = sevenDaysAgo();
    const [stores, recentSettlements, weeklySummary, outstanding, refills, materials] = await Promise.all([dbStores(), dbSettlements({ from: weekStart, take: 4 }), dbWeeklySettlementSummary(weekStart), dbCurrentOutstanding(), dbRefills(true), dbMaterials()]);
    const lowMaterials = materials.filter((item) => item.stock <= item.minStock * 1.5);
    return {
      source: "database",
      stores,
      settlements: recentSettlements,
      refills,
      lowMaterials,
      weeklyGross: weeklySummary.gross,
      ownerNet: weeklySummary.net,
      outstanding,
      cupsInStores: stores.reduce((sum, item) => sum + item.stock, 0),
      dueStores: stores.filter((item) => item.due).length,
      totalCapacity: stores.reduce((sum, item) => sum + (item.fridge?.capacityCups ?? 0), 0),
    };
  } catch (error) {
    console.error("[yogurt-db] dashboard query failed", error);
    return fallbackDashboard();
  }
}

export async function getReportsData(range?: { from?: Date; to?: Date }): Promise<ReportsData> {
  const fallback = async (): Promise<ReportsData> => {
    const dashboard = fallbackDashboard();
    const expenses = demoExpenseView();
    const expenseTotal = expenses.reduce((sum, item) => sum + item.amount, 0);
    const cheeseSold = dashboard.settlements.reduce((sum, item) => sum + item.cheeseSold, 0);
    const mangoSold = dashboard.settlements.reduce((sum, item) => sum + item.mangoSold, 0);
    const monthGross = dashboard.settlements.reduce((sum, item) => sum + item.gross, 0);
    const storeShare = dashboard.settlements.reduce((sum, item) => sum + item.commission, 0);
    const productCost = dashboard.settlements.reduce((sum, item) => sum + item.cogs, 0);
    const storeRows = buildStoreReportRows(dashboard.stores, dashboard.settlements, expenses);
    const productSalesMap=new Map<string,{productId:string;code:string;name:string;unitsSold:number}>(); for(const st of dashboard.settlements)for(const x of st.productSales){const prev=productSalesMap.get(x.productId);productSalesMap.set(x.productId,{...x,unitsSold:(prev?.unitsSold??0)+x.unitsSold})}
    return { source: "demo", monthGross, storeShare, expenses: expenseTotal, productCost, wasteCost: 0, storeWasteCost: 0, centralWasteCost: 0, wasteUnits: 0, costMode: "estimated", netProfit: monthGross - storeShare - productCost - expenseTotal, weeklyGross: dashboard.weeklyGross, unallocatedExpenses: expenses.filter(x=>!x.storeId).reduce((sum,x)=>sum+x.amount,0), electricityBudget: dashboard.stores.reduce((sum,x)=>sum+x.monthlyElectricity,0), cheeseSold, mangoSold, productSales:[...productSalesMap.values()], storeRows };
  };
  if (!(await canUseDatabase())) return fallback();
  try {
    const defaults = businessReportRange("month");
    const monthStart = range?.from ?? defaults.from;
    const nextMonth = range?.to ?? defaults.to;
    const weekStart = sevenDaysAgo();
    type StoreBase = { id:string; name:string; monthlyElectricity: unknown };
    type StoreAgg = { store_id:string; gross:unknown; commission:unknown; product_cost:unknown; all_actual:boolean; waste_cost:unknown; waste_units:unknown; waste_actual:boolean };
    type CentralWasteAgg = { cost:unknown; units:unknown; all_known:boolean };
    type ExpenseAgg = { store_id:string|null; total:unknown; transport:unknown; electricity:unknown };
    type ProductAgg = { product_id:string; code:string; name:string; units_sold:unknown };
    type WeeklyAgg = { gross:unknown };
    const [stores, storeAggs, expenseAggs, productAggs, weeklyRows, centralWasteRows] = await Promise.all([
      prisma.store.findMany({ orderBy:{name:"asc"}, select:{id:true,name:true,monthlyElectricity:true} }),
      prisma.$queryRaw<StoreAgg[]>`
        WITH per_settlement AS (
          SELECT s.id, s.store_id, s.gross_amount, s.store_commission_amount,
                 COALESCE(SUM(CASE WHEN i.units_sold > 0 THEN
                   CASE WHEN i.unknown_cost_units IS NOT NULL THEN i.subtotal_cost + ROUND(i.unknown_cost_units * i.retail_price * 0.28, 2)
                     WHEN i.subtotal_cost > 0 THEN i.subtotal_cost ELSE ROUND(i.subtotal_gross * 0.28, 2) END
                   ELSE 0 END), 0)
                   + CASE WHEN COUNT(i.id) = 0 AND s.gross_amount > 0 THEN ROUND(s.gross_amount * 0.28, 2) ELSE 0 END AS cogs,
                 CASE WHEN COUNT(i.id) = 0 THEN s.gross_amount = 0
                   ELSE BOOL_AND(i.units_sold <= 0 OR COALESCE(i.cost_known, false)) END AS all_actual,
                 -- Returned (expired or damaged) cups keep their lot cost; unknown-cost cups use the same 28% estimate.
                 COALESCE(SUM(i.expired_cost + CASE WHEN i.expired_unknown_units > 0 THEN ROUND(i.expired_unknown_units * i.retail_price * 0.28, 2) ELSE 0 END), 0) AS waste_cost,
                 COALESCE(SUM(i.count_expired_returned), 0) AS waste_units,
                 COALESCE(BOOL_AND(i.expired_unknown_units = 0), true) AS waste_actual
          FROM settlements s
          LEFT JOIN restock_visit_items i ON i.restock_visit_id = s.restock_visit_id
          WHERE s.settlement_date >= (${monthStart}::timestamptz AT TIME ZONE 'UTC') AND s.settlement_date < (${nextMonth}::timestamptz AT TIME ZONE 'UTC')
          GROUP BY s.id
        )
        SELECT store_id,
               COALESCE(SUM(gross_amount),0) AS gross,
               COALESCE(SUM(store_commission_amount),0) AS commission,
               COALESCE(SUM(cogs),0) AS product_cost,
               BOOL_AND(all_actual) AS all_actual,
               COALESCE(SUM(waste_cost),0) AS waste_cost,
               COALESCE(SUM(waste_units),0) AS waste_units,
               BOOL_AND(waste_actual) AS waste_actual
        FROM per_settlement
        GROUP BY store_id
      `,
      prisma.$queryRaw<ExpenseAgg[]>`
        SELECT store_id,
               COALESCE(SUM(amount),0) AS total,
               COALESCE(SUM(CASE WHEN LOWER(BTRIM(category)) IN ('fuel','transport','ຄ່ານ້ຳມັນ','ຄ່າຂົນສົ່ງ') THEN amount ELSE 0 END),0) AS transport,
               COALESCE(SUM(CASE WHEN LOWER(BTRIM(category)) IN ('electricity','ຄ່າໄຟ','ຄ່າໄຟຟ້າ') THEN amount ELSE 0 END),0) AS electricity
        FROM expenses
        WHERE voided_at IS NULL AND incurred_at >= (${monthStart}::timestamptz AT TIME ZONE 'UTC') AND incurred_at < (${nextMonth}::timestamptz AT TIME ZONE 'UTC')
        GROUP BY store_id
      `,
      prisma.$queryRaw<ProductAgg[]>`
        SELECT p.id AS product_id, p.code, p.name, COALESCE(SUM(i.units_sold),0) AS units_sold
        FROM settlements s
        JOIN restock_visit_items i ON i.restock_visit_id = s.restock_visit_id
        JOIN finished_products p ON p.id = i.finished_product_id
        WHERE s.settlement_date >= (${monthStart}::timestamptz AT TIME ZONE 'UTC') AND s.settlement_date < (${nextMonth}::timestamptz AT TIME ZONE 'UTC')
        GROUP BY p.id, p.code, p.name
        ORDER BY p.code
      `,
      prisma.$queryRaw<WeeklyAgg[]>`
        SELECT COALESCE(SUM(gross_amount),0) AS gross
        FROM settlements
        WHERE settlement_date >= (${weekStart}::timestamptz AT TIME ZONE 'UTC')
      `,
      // Cups written off at the central stock keep their batch cost; unknown-cost batches use the 28% estimate.
      prisma.$queryRaw<CentralWasteAgg[]>`
        SELECT COALESCE(SUM(CASE WHEN a.cost_known THEN ROUND(a.quantity * a.unit_cost, 2) ELSE ROUND(a.quantity * p.retail_price * 0.28, 2) END),0) AS cost,
               COALESCE(SUM(a.quantity),0) AS units,
               COALESCE(BOOL_AND(a.cost_known), true) AS all_known
        FROM finished_goods_adjustments a
        JOIN finished_products p ON p.id = a.finished_product_id
        WHERE a.created_at >= (${monthStart}::timestamptz AT TIME ZONE 'UTC') AND a.created_at < (${nextMonth}::timestamptz AT TIME ZONE 'UTC')
      `,
    ]);
    const aggByStore = new Map(storeAggs.map((row)=>[row.store_id,row]));
    const expenseByStore = new Map(expenseAggs.filter((row)=>row.store_id).map((row)=>[row.store_id as string,row]));
    const monthGross = moneyValue(storeAggs.reduce((sum,row)=>sum+n(row.gross),0));
    const storeShare = moneyValue(storeAggs.reduce((sum,row)=>sum+n(row.commission),0));
    const productCost = moneyValue(storeAggs.reduce((sum,row)=>sum+n(row.product_cost),0));
    const expenseTotal = moneyValue(expenseAggs.reduce((sum,row)=>sum+n(row.total),0));
    const productSales = productAggs.map((row)=>({productId:row.product_id,code:row.code,name:row.name,unitsSold:n(row.units_sold)}));
    const storeWasteCost = moneyValue(storeAggs.reduce((sum,row)=>sum+n(row.waste_cost),0));
    const centralWasteCost = moneyValue(n(centralWasteRows[0]?.cost));
    const wasteCost = moneyValue(storeWasteCost + centralWasteCost);
    const wasteUnits = storeAggs.reduce((sum,row)=>sum+n(row.waste_units),0) + n(centralWasteRows[0]?.units);
    const storeRows: ReportStoreRow[] = stores.map((store: StoreBase) => {
      const agg=aggByStore.get(store.id); const gross=n(agg?.gross); const storeShare=n(agg?.commission); const productCost=n(agg?.product_cost); const wasteCost=n(agg?.waste_cost);
      const expense=expenseByStore.get(store.id); const expenseTotal=n(expense?.total); const transport=n(expense?.transport); const electricity=n(expense?.electricity);
      return { storeId:store.id, storeName:store.name, gross, storeShare, electricity, transport, expenseTotal, otherExpenses:moneyValue(expenseTotal-electricity-transport), electricityBudget:n(store.monthlyElectricity), productCost, wasteCost, profit:moneyValue(gross-storeShare-expenseTotal-productCost-wasteCost) };
    }).filter((row)=>row.gross>0 || row.expenseTotal>0 || row.productCost>0 || row.wasteCost>0).sort((a,b)=>b.gross-a.gross);
    return {
      source:"database",
      monthGross,
      storeShare,
      expenses:expenseTotal,
      productCost,
      wasteCost,
      storeWasteCost,
      centralWasteCost,
      wasteUnits,
      costMode: storeAggs.every((row)=>row.all_actual && row.waste_actual) && (centralWasteRows[0]?.all_known ?? true) ? "actual" : "estimated",
      netProfit:moneyValue(monthGross-storeShare-productCost-wasteCost-expenseTotal),
      unallocatedExpenses: expenseAggs.filter(row=>!row.store_id).reduce((sum,row)=>sum+n(row.total),0),
      electricityBudget: stores.reduce((sum,store)=>sum+n(store.monthlyElectricity),0),
      weeklyGross:n(weeklyRows[0]?.gross),
      cheeseSold:productSales.filter((x)=>isCheese(x.code,x.name)).reduce((s,x)=>s+x.unitsSold,0),
      mangoSold:productSales.filter((x)=>isMango(x.code,x.name)).reduce((s,x)=>s+x.unitsSold,0),
      productSales,
      storeRows,
    };
  } catch (error) {
    console.error("[yogurt-db] reports query failed", error);
    return fallback();
  }
}

function buildStoreReportRows(stores: StoreView[], settlements: SettlementView[], expenses: ExpenseView[]): ReportStoreRow[] {
  return stores.map((store) => {
    const rows = settlements.filter((item) => item.storeId === store.id);
    const gross = rows.reduce((sum, item) => sum + item.gross, 0);
    const storeShare = rows.reduce((sum, item) => sum + item.commission, 0);
    const storeExpenses = expenses.filter(item=>item.storeId===store.id);
    const transport = storeExpenses.filter(item=>["fuel","transport","ຄ່ານ້ຳມັນ","ຄ່າຂົນສົ່ງ"].includes(item.category)).reduce((sum,item)=>sum+item.amount,0);
    const electricity = storeExpenses.filter(item=>["electricity","ຄ່າໄຟ","ຄ່າໄຟຟ້າ"].includes(item.category)).reduce((sum,item)=>sum+item.amount,0);
    const expenseTotal = storeExpenses.reduce((sum,item)=>sum+item.amount,0);
    const productCost = rows.reduce((sum,item)=>sum+item.cogs,0);
    return { storeId:store.id, storeName:store.name, gross, storeShare, electricity, transport, otherExpenses:moneyValue(expenseTotal-electricity-transport), expenseTotal, electricityBudget:store.monthlyElectricity, productCost, wasteCost:0, profit:moneyValue(gross-storeShare-expenseTotal-productCost) };
  }).filter(row=>row.gross>0 || row.expenseTotal>0 || row.productCost>0).sort((a,b)=>b.gross-a.gross);
}

type ProductionBatchDelegate = {
  findMany(args: unknown): Promise<Array<{
    id: string; batchNumber: string; finishedProductId: string; quantityProduced: number; quantityRemaining: number; totalMaterialCost: unknown; unitCost: unknown; costKnown:boolean; mfgDate: Date; expDate: Date;
    finishedProduct: { id: string; code: string; name: string; shelfLifeDays: number };
  }>>;
};

export async function getProductionData(options?: { historyPage?: number }): Promise<ProductionData> {
  const requestedPage = options?.historyPage ? Math.max(1, Math.min(1000000, Math.trunc(options.historyPage))) : null;
  const metadata = (products: ProductionProductView[], batches: ProductionBatchView[], totalBatches=batches.length, historyPage=requestedPage, adjustmentBatches=batches) => ({ adjustmentBatches, totalBatches, historyPage, pageCount:Math.max(1, Math.ceil(totalBatches/50)), centralStockTotal:products.reduce((sum,p)=>sum+p.centralStock,0) });
  if (!(await canUseDatabase())) {
    const products: ProductionProductView[] = demoProducts.map((product) => ({
      id: product.id,
      code: product.id === "p-cheese" ? "YG-CHS-74" : "YG-MNG-74",
      name: product.name,
      centralStock: product.id === "p-cheese" ? 220 : 190,
      shelfLifeDays: 21,
    }));
    const batches: ProductionBatchView[] = [
      { id: "demo-batch-cheese", batchNumber: "CHS-20260915-001", productId: "p-cheese", productName: products[0]?.name ?? "Cheese", quantityProduced: 300, quantityRemaining: 220, totalMaterialCost: 0, unitCost: 0, costKnown:false, mfgDate: "15/09/2026", expDate: "06/10/2026", daysToExpiry: 16 },
      { id: "demo-batch-mango", batchNumber: "MNG-20260915-001", productId: "p-mango", productName: products[1]?.name ?? "Mango", quantityProduced: 250, quantityRemaining: 190, totalMaterialCost: 0, unitCost: 0, costKnown:false, mfgDate: "15/09/2026", expDate: "06/10/2026", daysToExpiry: 16 },
    ];
    return { source: "demo", products, batches, ...metadata(products, batches) };
  }
  try {
    const productsRaw = await prisma.finishedProduct.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
    const delegate = prisma.productionBatch as unknown as ProductionBatchDelegate;
    const now = new Date();
    const activeWhere = { status: "completed" as const, quantityRemaining: { gt: 0 } };
    const historyWhere = { status: "completed" as const };
    const totalBatches = await prisma.productionBatch.count({where: requestedPage ? historyWhere : activeWhere});
    const historyPage = requestedPage ? Math.min(requestedPage, Math.max(1,Math.ceil(totalBatches/50))) : null;
    const [batchesRaw, activeRaw, stockGroups] = await Promise.all([
      delegate.findMany({ where:historyPage?historyWhere:activeWhere, orderBy: historyPage?[{mfgDate:"desc"},{id:"desc"}]:[{expDate:"asc"},{mfgDate:"asc"},{id:"asc"}], ...(historyPage?{take:50,skip:(historyPage-1)*50}:{}), include:{finishedProduct:true} }),
      historyPage?delegate.findMany({where:activeWhere,orderBy:[{expDate:"asc"},{id:"asc"}],include:{finishedProduct:true}}):Promise.resolve(null),
      prisma.productionBatch.groupBy({by:["finishedProductId"],where:{...activeWhere,expDate:{gte:now}},_sum:{quantityRemaining:true}}),
    ]);
    const today = Date.now();
    const toBatch = (batch: (typeof batchesRaw)[number]): ProductionBatchView => ({
      id: batch.id,
      batchNumber: batch.batchNumber,
      productId: batch.finishedProductId,
      productName: batch.finishedProduct.name,
      quantityProduced: batch.quantityProduced,
      quantityRemaining: batch.quantityRemaining,
      totalMaterialCost: n(batch.totalMaterialCost),
      unitCost: n(batch.unitCost),
      costKnown: batch.costKnown,
      mfgDate: dateText(batch.mfgDate),
      expDate: dateText(batch.expDate),
      daysToExpiry: batch.expDate.getTime()<today ? Math.floor((batch.expDate.getTime()-today)/86400000) : Math.ceil((batch.expDate.getTime()-today)/86400000),
    });
    const batches = batchesRaw.map(toBatch);
    const stockByProduct = new Map(stockGroups.map(row=>[row.finishedProductId,row._sum.quantityRemaining??0]));
    const products: ProductionProductView[] = productsRaw.map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      shelfLifeDays: product.shelfLifeDays,
      centralStock: stockByProduct.get(product.id) ?? 0,
    }));
    return { source: "database", products, batches, ...metadata(products,batches,totalBatches,historyPage,activeRaw?activeRaw.map(toBatch):batches) };
  } catch (error) {
    console.error("[yogurt-db] production query failed", error);
    const products: ProductionProductView[] = demoProducts.map((product) => ({ id: product.id, code: product.id === "p-cheese" ? "YG-CHS-74" : "YG-MNG-74", name: product.name, centralStock: product.id === "p-cheese" ? 220 : 190, shelfLifeDays: 21 }));
    return { source: "demo", products, batches: [], ...metadata(products,[]) };
  }
}


async function notificationExtras() {
  if (!(await canUseDatabase())) return { source:"demo" as DataSource, expiringCount:0, expiring:[] as Array<{batchNumber:string;expDate:Date}>, maintenanceCount:0, maintenance:[] as Array<{assetCode:string;currentStore:{name:string}|null}> };
  const now=new Date(); const until=new Date(now.getTime()+7*86400000);
  const where={status:"completed" as const,quantityRemaining:{gt:0},expDate:{gte:now,lte:until}};
  const [expiringCount,expiring,maintenanceCount,maintenance]=await Promise.all([
    prisma.productionBatch.count({where}),
    prisma.productionBatch.findMany({where,orderBy:[{expDate:"asc"},{id:"asc"}],take:4,select:{batchNumber:true,expDate:true}}),
    prisma.fridge.count({where:{status:"maintenance"}}),
    prisma.fridge.findMany({where:{status:"maintenance"},take:4,orderBy:{assetCode:"asc"},select:{assetCode:true,currentStore:{select:{name:true}}}}),
  ]);
  return {source:"database" as DataSource,expiringCount,expiring,maintenanceCount,maintenance};
}

/** Shown when no alert is left for the viewer. */
export const ALL_CLEAR_ALERT: NotificationView = { id: "all-clear", type: "info", title: "ບໍ່ມີລາຍການດ່ວນ", detail: "ສິນຄ້າຄົງເຫຼືອ, ການເຕີມສິນຄ້າ, ຍອດຄ້າງ ແລະຕູ້ແຊ່ບໍ່ມີສັນຍານເຕືອນໃນຂະນະນີ້", href: "/" };

export async function getNotificationsData(existingDashboard?: DashboardData | Promise<DashboardData>): Promise<{ source: DataSource; alerts: NotificationView[] }> {
  const [dashboard, extras] = await Promise.all([existingDashboard ?? getDashboardData(), notificationExtras().catch(error=>{console.error("[yogurt-db] notification query failed",error);return {source:"demo" as DataSource,expiringCount:0,expiring:[],maintenanceCount:0,maintenance:[]};})]);
  const alerts: NotificationView[] = [];
  const due = dashboard.stores.filter((store) => store.due);
  for (const store of due.slice(0, 4)) alerts.push({ id: `due-store-${store.id}`, type: "urgent", title: `${store.name} ຮອດຮອບກວດ`, detail: `${store.fridge?.assetCode ?? "ບໍ່ມີຕູ້"} · ຄົງເຫຼືອ ${store.stock} ຖ້ວຍ`, href: `/driver/restock/${store.id}` });
  if (due.length > 4) alerts.push({ id: "due-stores-more", type: "urgent", title: `ອີກ ${due.length - 4} ຮ້ານຮອດຮອບກວດ`, detail: "ເປີດຄິວກວດຮ້ານທັງໝົດ", href: "/driver" });
  const waiting = dashboard.refills.filter((item) => item.status === "waiting" || item.status === "preparing");
  if (waiting.length) alerts.push({ id: "refills", type: "urgent", title: `${waiting.length} ຄຳຂໍເຕີມສິນຄ້າຕ້ອງຈັດການ`, detail: waiting.slice(0, 4).map((item) => item.storeName).join(" · "), href: "/refills" });
  for (const material of dashboard.lowMaterials.slice(0, 5)) alerts.push({ id: `material-${material.id}`, type: "warning", title: `${material.name} ໃກ້ຈຸດສັ່ງຊື້`, detail: `ຄົງເຫຼືອ ${material.stock} ${material.unit} · ຈຸດແຈ້ງເຕືອນ ${material.minStock} ${material.unit}`, href: "/inventory" });
  if (dashboard.outstanding > 0) alerts.push({ id: "receivables", type: "warning", title: `ຍອດຄ້າງຮັບ ${dashboard.outstanding.toLocaleString()} LAK`, detail: "ຄິດຈາກຍອດຄົງຄ້າງຫຼ້າສຸດຂອງແຕ່ລະຮ້ານ", href: "/settlements" });
  if (extras.expiringCount) alerts.push({ id:"expiring",type:"warning",title:`${extras.expiringCount} ລັອດຜະລິດໃກ້ໝົດອາຍຸ`,detail:extras.expiring.map(batch=>`${batch.batchNumber} · ${Math.ceil((batch.expDate.getTime()-Date.now())/86400000)} ມື້`).join(" · "),href:"/production" });
  if (extras.maintenanceCount) alerts.push({id:"maintenance",type:"info",title:`${extras.maintenanceCount} ຕູ້ຢູ່ສະຖານະບຳລຸງຮັກສາ`,detail:extras.maintenance.map(fridge=>`${fridge.assetCode} · ${fridge.currentStore?.name??"—"}`).join(" · "),href:"/fridges"});
  if (extras.source==="demo"&&dashboard.source==="database") alerts.push({id:"notification-unavailable",type:"warning",title:"ກວດກາສິນຄ້າໃກ້ໝົດອາຍຸບໍ່ສຳເລັດ",detail:"ກະລຸນາໂຫຼດໜ້າຄືນ",href:"/notifications"});
  if (!alerts.length) alerts.push(ALL_CLEAR_ALERT);
  return { source: dashboard.source, alerts };
}
