import type { Prisma } from "@prisma/client";
import type { UserRole } from "@/lib/auth-session";
import type { NativeQuery, NativeResource } from "@/lib/native-access";
import { prisma } from "@/lib/prisma";
import { canRoleOpen } from "@/lib/access-policy";
import { businessDateString, businessReportRange, parseDateOnly } from "@/lib/date-only";
import { dailyClosingSnapshot } from "@/lib/daily-closing";
import { loadBackupReadiness } from "@/lib/backup-readiness";
import {
  getDashboardData, getExpensesData, getFridgesData, getInventoryData, getMapData,
  getNotificationsData, getProductionData, getRefillsData, getReportsData,
  getRestockStoreData, getSettlementsData, getStoreOptions, getStoresData,
  type DataSource, type NotificationView,
} from "@/lib/db-data";

export class NativeReadError extends Error {
  constructor(public status: 404 | 503, message: string) { super(message); this.name = "NativeReadError"; }
}
const notFound = () => new NativeReadError(404, "ບໍ່ພົບລາຍການນີ້");
const decimal = (value: { toString(): string } | null | undefined) => value == null ? null : value.toString();
const sourceOf = (...sources: DataSource[]): DataSource => sources.every(source => source === "database") ? "database" : "demo";
const result = <T>(data: T & { source: DataSource }) => ({ source: data.source, data });
const filterNotifications = (data: { source: DataSource; alerts: NotificationView[] }, role: UserRole) => ({ ...data, alerts: data.alerts.filter(alert => canRoleOpen(role, alert.href)) });

const productSelect = { id: true, code: true, name: true, sizeDescription: true, retailPrice: true, shelfLifeDays: true, isActive: true } satisfies Prisma.FinishedProductSelect;
const materialSelect = { id: true, code: true, name: true, category: true, unit: true, currentStock: true, minStockAlert: true, avgCostPerUnit: true, isActive: true } satisfies Prisma.RawMaterialSelect;
type Product = Prisma.FinishedProductGetPayload<{ select: typeof productSelect }>;
type Material = Prisma.RawMaterialGetPayload<{ select: typeof materialSelect }>;
const productProjection = (row: Product) => ({ id: row.id, code: row.code, name: row.name, sizeDescription: row.sizeDescription, retailPrice: row.retailPrice.toString(), shelfLifeDays: row.shelfLifeDays, isActive: row.isActive });
const materialProjection = (row: Material) => ({ id: row.id, code: row.code, name: row.name, category: row.category, unit: row.unit, currentStock: row.currentStock.toString(), minStockAlert: row.minStockAlert.toString(), avgCostPerUnit: row.avgCostPerUnit.toString(), isActive: row.isActive });
const materials = (all = false) => prisma.rawMaterial.findMany({ where: all ? {} : { isActive: true }, orderBy: { name: "asc" }, select: materialSelect }).then(rows => rows.map(materialProjection));
const products = (all = false) => prisma.finishedProduct.findMany({ where: all ? {} : { isActive: true }, orderBy: { name: "asc" }, select: productSelect }).then(rows => rows.map(productProjection));

async function recipes() {
  const rows = await prisma.recipe.findMany({
    where: { isDefault: true, finishedProduct: { isActive: true } }, orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, finishedProductId: true, name: true, baseCups: true, version: true, isDefault: true,
      finishedProduct: { select: { id: true, code: true, name: true, isActive: true } },
      items: { orderBy: { rawMaterialId: "asc" }, select: { rawMaterialId: true, quantityRequired: true, rawMaterial: { select: materialSelect } } },
    },
  });
  return rows.map(row => ({ id: row.id, finishedProductId: row.finishedProductId, name: row.name, baseCups: row.baseCups, version: row.version, isDefault: row.isDefault,
    finishedProduct: { id: row.finishedProduct.id, code: row.finishedProduct.code, name: row.finishedProduct.name, isActive: row.finishedProduct.isActive },
    items: row.items.map(item => ({ rawMaterialId: item.rawMaterialId, quantityRequired: item.quantityRequired.toString(), rawMaterial: materialProjection(item.rawMaterial) })),
  }));
}

const fridgeSelect = { id: true, assetCode: true, model: true, serialNo: true, capacityCups: true, status: true } satisfies Prisma.FridgeSelect;
const settlementSelect = { id: true, receiptNumber: true, slipImageUrl: true, settlementDate: true, grossAmount: true, storeCommissionAmount: true, netPayableAmount: true, previousBalance: true, paidAmount: true, closingBalance: true, paymentStatus: true, paymentMethod: true } satisfies Prisma.SettlementSelect;
const latestPaymentSelect = { closingBalance: true, paidAmount: true, settlementDate: true } satisfies Prisma.SettlementSelect;

/** One store only: current fridge inventory plus bounded recent domain history. */
async function storeDetail(id: string, role: UserRole) {
  const row = await prisma.store.findUnique({ where: { id }, select: {
    id: true, name: true, contactName: true, phone: true, whatsapp: true, facebook: true, address: true,
    latitude: true, longitude: true, commissionRate: true, monthlyElectricity: true, fridgeStartDate: true, isActive: true,
    fridge: { select: fridgeSelect },
    fridgeInventory: { where: { fridge: { currentStoreId: id } }, orderBy: { finishedProduct: { name: "asc" } }, select: {
      id: true, fridgeId: true, finishedProductId: true, currentStock: true, lastAuditDate: true, finishedProduct: { select: productSelect },
    } },
    refillRequests: { where: { status: { in: ["waiting", "preparing", "delivering"] } }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: 5,
      select: { id: true, status: true, requestedAt: true, deliveredAt: true, note: true, items: { select: { finishedProductId: true, quantity: true, finishedProduct: { select: { code: true, name: true } } } } },
    },
    settlements: { orderBy: [{ settlementDate: "desc" }, { id: "desc" }], take: role === "production" ? 1 : 8, select: role === "production" ? latestPaymentSelect : settlementSelect },
    restockVisits: { where: { status: "completed" }, orderBy: [{ visitDate: "desc" }, { id: "desc" }], take: 6, select: { id: true, visitDate: true, status: true } },
  } });
  if (!row) throw notFound();
  const fridge = row.fridge ? { id: row.fridge.id, assetCode: row.fridge.assetCode, model: row.fridge.model, serialNo: row.fridge.serialNo, capacityCups: row.fridge.capacityCups, status: row.fridge.status } : null;
  const store = { id: row.id, name: row.name, contactName: row.contactName, phone: row.phone, whatsapp: row.whatsapp, facebook: row.facebook, address: row.address,
    latitude: decimal(row.latitude), longitude: decimal(row.longitude), commissionRate: row.commissionRate.toString(), monthlyElectricity: row.monthlyElectricity.toString(),
    fridgeStartDate: row.fridgeStartDate ? businessDateString(row.fridgeStartDate) : null, isActive: row.isActive, fridge,
  };
  const inventory = row.fridgeInventory.filter(item => item.fridgeId === row.fridge?.id).map(item => ({ id: item.id, productId: item.finishedProductId, currentStock: item.currentStock, lastAuditDate: item.lastAuditDate?.toISOString() ?? null, product: productProjection(item.finishedProduct) }));
  const visits = row.restockVisits.map(visit => ({ id: visit.id, visitDate: visit.visitDate.toISOString(), status: visit.status }));
  const view = { ...store, contactName: row.contactName ?? "—", phone: row.phone ?? "—", whatsapp: row.whatsapp ?? "—", facebook: row.facebook ?? "—", address: row.address ?? "—",
    latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude), commissionRate: Number(row.commissionRate), monthlyElectricity: Number(row.monthlyElectricity),
    stock: inventory.reduce((sum, item) => sum + item.currentStock, 0), due: !row.restockVisits[0] || row.restockVisits[0].visitDate.getTime() < Date.now() - 7 * 86400000,
  };
  const latest = row.settlements[0];
  // Prisma infers the fields common to both role selects; the full branch is
  // selected only for admin/driver, and production never consumes these rows.
  const settlementRows = role === "production" ? [] : row.settlements as Prisma.SettlementGetPayload<{ select: typeof settlementSelect }>[];
  return { store, view, inventory, latestBalance: latest?.closingBalance.toString() ?? "0",
    latestSettlement: latest ? { paidAmount: latest.paidAmount.toString(), closingBalance: latest.closingBalance.toString(), settlementDate: latest.settlementDate.toISOString() } : null,
    refills: row.refillRequests.map(refill => ({ id: refill.id, storeId: row.id, storeName: row.name, status: refill.status, requestedAt: refill.requestedAt.toISOString(), deliveredAt: refill.deliveredAt?.toISOString() ?? null, note: refill.note,
    items: refill.items.map(item => ({ productId: item.finishedProductId, code: item.finishedProduct.code, name: item.finishedProduct.name, quantity: item.quantity })),
  })), settlements: settlementRows.map(item => ({ id: item.id, receiptNumber: item.receiptNumber, receiptPath: item.slipImageUrl, slipImageUrl: item.slipImageUrl, settlementDate: item.settlementDate.toISOString(),
    grossAmount: item.grossAmount.toString(), storeCommissionAmount: item.storeCommissionAmount.toString(), netPayableAmount: item.netPayableAmount.toString(), previousBalance: item.previousBalance.toString(), paidAmount: item.paidAmount.toString(), closingBalance: item.closingBalance.toString(), paymentStatus: item.paymentStatus, paymentMethod: item.paymentMethod,
  })), visits };
}

async function expenseDetail(id: string) {
  const [row, choices] = await Promise.all([
    prisma.expense.findUnique({ where: { id }, select: { id: true, category: true, amount: true, incurredAt: true, storeId: true, note: true, receiptUrl: true, voidedAt: true, store: { select: { name: true } } } }),
    getStoreOptions(),
  ]);
  if (!row || row.voidedAt) throw notFound();
  const snapshot = { category: row.category, amount: row.amount.toString(), incurredAt: businessDateString(row.incurredAt), storeId: row.storeId, note: row.note, receiptUrl: row.receiptUrl };
  return { source: choices.source, data: { expense: { id: row.id, ...snapshot, storeName: row.store?.name ?? null, expectedExpenseSnapshot: snapshot }, stores: choices.stores } };
}

async function restockDetail(id: string) {
  const [display, raw] = await Promise.all([
    getRestockStoreData(id),
    prisma.store.findUnique({ where: { id }, select: { commissionRate: true, isActive: true, fridge: { select: { id: true } },
      settlements: { orderBy: [{ settlementDate: "desc" }, { id: "desc" }], take: 1, select: { closingBalance: true } },
      fridgeInventory: { where: { fridge: { currentStoreId: id } }, select: { finishedProductId: true, finishedProduct: { select: { retailPrice: true } } } },
    } }),
  ]);
  if (!display?.data || !raw || !raw.isActive || !raw.fridge) throw notFound();
  if (display.source !== "database") return result(display);
  const previousBalance = raw.settlements[0]?.closingBalance.toString() ?? "0";
  const commissionRate = raw.commissionRate.toString();
  const prices = new Map(raw.fridgeInventory.map(item => [item.finishedProductId, item.finishedProduct.retailPrice.toString()]));
  const lines = display.data.lines.map(line => {
    const retailPrice = prices.get(line.productId);
    if (retailPrice === undefined) throw new NativeReadError(503, "ສິນຄ້າໃນຮ້ານປ່ຽນແລ້ວ. ກະລຸນາໂຫຼດຄືນ");
    return { ...line, retailPrice };
  });
  return result({ source: display.source, data: { ...display.data, store: { ...display.data.store, commissionRate }, previousBalance, lines,
    expectedFinancialSnapshot: { previousBalance, commissionRate, retailPrices: lines.map(line => ({ productId: line.productId, retailPrice: line.retailPrice })) },
  } });
}

// Audit data may contain historical metadata: credentials are never a native projection.
function safeMetadata(value: Prisma.JsonValue, depth = 0): Prisma.JsonValue {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.map(item => safeMetadata(item, depth + 1));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|secret|token|cookie|authorization|credential|database.?url/i.test(key))
    .map(([key, item]) => [key, safeMetadata(item ?? null, depth + 1)]));
  return value;
}

async function auditData(query: NativeQuery) {
  const filter = query.filter ?? "all";
  const and: Prisma.AuditLogWhereInput[] = [];
  if (filter === "update" || filter === "adjust") and.push({ action: filter });
  if (filter === "expense" || filter === "user") and.push({ entityType: { contains: filter, mode: "insensitive" } });
  if (query.query) and.push({ OR: [{ summary: { contains: query.query, mode: "insensitive" } }, { entityType: { contains: query.query, mode: "insensitive" } }, { store: { is: { name: { contains: query.query, mode: "insensitive" } } } }, { user: { is: { fullName: { contains: query.query, mode: "insensitive" } } } }] });
  const where = and.length ? { AND: and } : undefined;
  const total = await prisma.auditLog.count({ where });
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page ?? 1, totalPages);
  const rows = await prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize, skip: (page - 1) * pageSize,
    select: { id: true, action: true, entityType: true, entityId: true, storeId: true, summary: true, metadata: true, createdAt: true, user: { select: { fullName: true, role: true } }, store: { select: { name: true } } },
  });
  return { logs: rows.map(row => ({ id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId, storeId: row.storeId, summary: row.summary, createdAt: row.createdAt.toISOString(),
    user: row.user ? { fullName: row.user.fullName, role: row.user.role } : null, store: row.store ? { name: row.store.name } : null, metadata: safeMetadata(row.metadata),
  })), total, page, totalPages, pageSize, query: query.query ?? "", filter };
}

export async function loadNativeData(resource: NativeResource, query: NativeQuery, role: UserRole): Promise<{ source: DataSource; data: unknown }> {
  switch (resource) {
    case "overview": {
      const dashboardPromise = getDashboardData();
      const [dashboard, notifications] = await Promise.all([dashboardPromise, getNotificationsData(dashboardPromise)]);
      return { source: sourceOf(dashboard.source, notifications.source), data: { dashboard: { ...dashboard, settlements: [], ownerNet: role === "admin" ? dashboard.ownerNet : 0,
        ...(role === "driver" ? { lowMaterials: [] } : {}),
        ...(role === "production" ? { outstanding: 0 } : {}),
      }, notifications: filterNotifications(notifications, role) } };
    }
    case "stores": return result(await getStoresData());
    case "store": return { source: "database", data: await storeDetail(query.id!, role) };
    case "map": return result(await getMapData());
    case "refills": {
      if (!query.id) return result(await getRefillsData());
      const row = await prisma.refillRequest.findUnique({ where: { id: query.id }, select: { id: true, storeId: true, status: true, requestedAt: true, deliveredAt: true, note: true,
        store: { select: { name: true, address: true, phone: true } }, items: { select: { finishedProductId: true, quantity: true, finishedProduct: { select: { code: true, name: true } } } },
      } });
      if (!row) throw notFound();
      const items = row.items.map(item => ({ productId: item.finishedProductId, code: item.finishedProduct.code, name: item.finishedProduct.name, quantity: item.quantity }));
      return result({ source: "database", refills: [{ id: row.id, storeId: row.storeId, storeName: row.store.name, address: row.store.address ?? "—", phone: row.store.phone ?? "—", status: row.status,
        requestedAt: row.requestedAt.toISOString(), deliveredAt: row.deliveredAt?.toISOString() ?? null, note: row.note, items,
        cheeseQty: items.filter(item => /CHS|cheese|ຊີສ/i.test(`${item.code} ${item.name}`)).reduce((sum, item) => sum + item.quantity, 0),
        mangoQty: items.filter(item => /MNG|mango|ໝາກມ່ວງ/i.test(`${item.code} ${item.name}`)).reduce((sum, item) => sum + item.quantity, 0),
      }] });
    }
    case "restock": return restockDetail(query.id!);
    case "inventory": {
      const [display, rawMaterials] = await Promise.all([getInventoryData(), materials()]);
      return result({ ...display, rawMaterials });
    }
    case "production": {
      const [display, rawMaterials, planner] = await Promise.all([getProductionData({ historyPage: query.historyPage }), materials(), recipes()]);
      return result({ ...display, materials: rawMaterials, recipes: planner });
    }
    case "settlements": {
      const display = await getSettlementsData(query);
      if (display.source !== "database" || !display.settlements.length) return result(display);
      // Existing display ids may be receipt numbers; constrain supplemental reads to this page only.
      const ids = display.settlements.map(item => item.id);
      const rows = await prisma.settlement.findMany({ where: { OR: [{ id: { in: ids } }, { receiptNumber: { in: ids } }] }, take: 50, select: settlementSelect });
      const byId = new Map(rows.flatMap(row => [[row.id, row] as const, ...(row.receiptNumber ? [[row.receiptNumber, row] as const] : [])]));
      return result({ ...display, settlements: display.settlements.map(item => {
        const row = byId.get(item.id);
        return { ...item, settlementId: row?.id ?? null, receiptNumber: row?.receiptNumber ?? null, receiptPath: row?.slipImageUrl ?? null, slipImageUrl: row?.slipImageUrl ?? null,
          settlementDate: row?.settlementDate.toISOString() ?? null, previousBalance: row?.previousBalance.toString() ?? null, paymentMethod: row?.paymentMethod ?? null,
          grossAmount: row?.grossAmount.toString() ?? null, storeCommissionAmount: row?.storeCommissionAmount.toString() ?? null, netPayableAmount: row?.netPayableAmount.toString() ?? null,
          paidAmount: row?.paidAmount.toString() ?? null, closingBalanceExact: row?.closingBalance.toString() ?? null };
      }) });
    }
    case "expenses": return result(await getExpensesData(query));
    case "expense": return expenseDetail(query.id!);
    case "reports": {
      const range = businessReportRange(query.period === "week" ? "7d" : query.period ?? "month");
      return result({ ...await getReportsData(range), range: { from: range.from.toISOString(), to: range.to.toISOString(), timeZone: "Asia/Vientiane" } });
    }
    case "notifications": return result(filterNotifications(await getNotificationsData(), role));
    case "operations": {
      const [productRows, materialRows, recipeRows, backup] = await Promise.all([products(true), materials(true), recipes(), loadBackupReadiness(process.cwd(), process.env.DATABASE_URL ?? "")]);
      return result({ source: "database", products: productRows, materials: materialRows, recipes: recipeRows, backup });
    }
    case "fridges": {
      const [display, options] = await Promise.all([getFridgesData(), getStoreOptions()]);
      return result({ ...display, source: sourceOf(display.source, options.source), stores: options.stores });
    }
    case "audit": return { source: "database", data: await auditData(query) };
    case "catalog": {
      const [storeRows, productRows, materialRows, recipeRows, categoryRows] = await Promise.all([
        role === "production" ? [] : prisma.store.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, fridge: { select: { id: true } } } }),
        products(), role === "driver" ? [] : materials(), role === "driver" ? [] : recipes(),
        role === "admin" ? prisma.expenseCategory.findMany({ orderBy: [{ createdAt: "asc" }, { name: "asc" }], select: { id: true, name: true } }) : [],
      ]);
      return result({ source: "database", stores: storeRows.map(row => ({ id: row.id, name: row.name, fridgeId: row.fridge?.id ?? null })),
        products: productRows.map(row => ({ id: row.id, code: row.code, name: row.name, retailPrice: row.retailPrice, shelfLifeDays: row.shelfLifeDays })),
        materials: materialRows, recipes: recipeRows, categories: categoryRows.map(row => ({ id: row.id, name: row.name })),
      });
    }
    case "closing": {
      const closingDate = parseDateOnly(query.date)!;
      const row = await prisma.dailyClosing.findUnique({ where: { closingDate }, select: { id: true, cashAmount: true, bankAmount: true, expenseAmount: true, note: true } });
      return { source: "database", data: { closingDate: query.date, snapshot: row ? dailyClosingSnapshot(row) : null } };
    }
  }
}
