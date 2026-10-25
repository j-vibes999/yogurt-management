export type DemoProduct = {
  id: string;
  code: string;
  name: string;
  retailPrice: number;
  color: string;
};

export type DemoStore = {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  facebook: string;
  address: string;
  commissionRate: number;
  fridgeStartDate: string;
  latitude: number;
  longitude: number;
};

export type DemoFridge = {
  id: string;
  assetCode: string;
  model: string;
  serialNo: string;
  storeId: string;
  status: "active" | "maintenance";
};

export type DemoInventoryLine = {
  storeId: string;
  fridgeId: string;
  productId: string;
  currentStock: number;
  lastAuditDate: string;
};

export type RefillRequest = {
  id: string;
  storeId: string;
  requestedAt: string;
  status: "waiting" | "delivering" | "completed";
  cheeseQty: number;
  mangoQty: number;
  note?: string;
};

export type DemoSettlement = {
  id: string;
  storeId: string;
  periodLabel: string;
  cheeseSold: number;
  mangoSold: number;
  gross: number;
  commission: number;
  net: number;
  paid: number;
  paymentMethod: "cash" | "bank" | "mixed";
  status: "paid" | "partial" | "pending";
};

export type RawMaterialDemo = {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  avgCost: number;
  category: "ingredient" | "packaging";
};

export const demoProducts: DemoProduct[] = [
  { id: "p-cheese", code: "YG-CHS-74", name: "ໂຢເກີດລົດນົມຊີສ", retailPrice: 20000, color: "#f2c94c" },
  { id: "p-mango", code: "YG-MNG-74", name: "ໂຢເກີດລົດໝາກມ່ວງ", retailPrice: 20000, color: "#f2994a" },
];

export const demoStores: DemoStore[] = [
  { id: "store-01", name: "Mekong Garden", contactName: "ທ່ານ ນ້ອຍ", phone: "020 5555 1001", whatsapp: "020 5555 1001", facebook: "Mekong Garden", address: "ຖະໜົນຟ້າງຸ່ມ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-07-01", latitude: 17.9628, longitude: 102.6048 },
  { id: "store-02", name: "Sabaidee Cafe", contactName: "ທ່ານ ມາຍ", phone: "020 5555 1002", whatsapp: "020 5555 1002", facebook: "Sabaidee Cafe", address: "ຖະໜົນເສດຖາທິລາດ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-07-08", latitude: 17.9662, longitude: 102.6141 },
  { id: "store-03", name: "Vientiane Kitchen", contactName: "ທ່ານ ລີ", phone: "020 5555 1003", whatsapp: "020 5555 1003", facebook: "Vientiane Kitchen", address: "ຖະໜົນສາມແສນໄທ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-07-15", latitude: 17.9666, longitude: 102.6088 },
  { id: "store-04", name: "Green Bowl", contactName: "ທ່ານ ແອນ", phone: "020 5555 1004", whatsapp: "020 5555 1004", facebook: "Green Bowl VTE", address: "ທາດຫຼວງ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-07-22", latitude: 17.9758, longitude: 102.6331 },
  { id: "store-05", name: "Daily Corner", contactName: "ທ່ານ ບຸນ", phone: "020 5555 1005", whatsapp: "020 5555 1005", facebook: "Daily Corner", address: "ສີສັດຕະນາກ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-08-01", latitude: 17.9487, longitude: 102.6205 },
  { id: "store-06", name: "Home Taste", contactName: "ທ່ານ ປຸ້ຍ", phone: "020 5555 1006", whatsapp: "020 5555 1006", facebook: "Home Taste Laos", address: "ໂພນສະຫວັນ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-08-06", latitude: 17.9875, longitude: 102.6217 },
  { id: "store-07", name: "Fresh Day", contactName: "ທ່ານ ດາ", phone: "020 5555 1007", whatsapp: "020 5555 1007", facebook: "Fresh Day Vientiane", address: "ດົງປ່າລານ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-08-12", latitude: 17.9519, longitude: 102.6094 },
  { id: "store-08", name: "Baan Cafe", contactName: "ທ່ານ ຕິກ", phone: "020 5555 1008", whatsapp: "020 5555 1008", facebook: "Baan Cafe", address: "ໂພນຕ້ອງ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-08-18", latitude: 17.9818, longitude: 102.6432 },
  { id: "store-09", name: "River View Eatery", contactName: "ທ່ານ ແກ້ວ", phone: "020 5555 1009", whatsapp: "020 5555 1009", facebook: "River View Eatery", address: "ແຄມຂອງ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-08-25", latitude: 17.9597, longitude: 102.5972 },
  { id: "store-10", name: "Happy Meal", contactName: "ທ່ານ ພອນ", phone: "020 5555 1010", whatsapp: "020 5555 1010", facebook: "Happy Meal Laos", address: "ໄຊເສດຖາ, ວຽງຈັນ", commissionRate: 0.30, fridgeStartDate: "2026-09-01", latitude: 17.9776, longitude: 102.6493 },
];

export const demoFridges: DemoFridge[] = demoStores.map((store, index) => ({
  id: `fridge-${String(index + 1).padStart(2, "0")}`,
  assetCode: `FR-${String(index + 1).padStart(3, "0")}`,
  model: "Yogurt Display 100",
  serialNo: `YD100-${String(index + 1).padStart(4, "0")}`,
  storeId: store.id,
  status: index === 7 ? "maintenance" : "active",
}));

const stocks = [
  [18, 12], [8, 6], [27, 24], [15, 20], [5, 9],
  [32, 31], [11, 7], [0, 0], [21, 19], [13, 17],
];

export const demoInventory: DemoInventoryLine[] = demoStores.flatMap((store, index) => {
  const fridge = demoFridges[index];
  return [
    { storeId: store.id, fridgeId: fridge.id, productId: "p-cheese", currentStock: stocks[index][0], lastAuditDate: "2026-09-13" },
    { storeId: store.id, fridgeId: fridge.id, productId: "p-mango", currentStock: stocks[index][1], lastAuditDate: "2026-09-13" },
  ];
});

export const weeklyVisitStatus: Record<string, "pending" | "completed"> = {
  "store-01": "pending", "store-02": "pending", "store-03": "completed", "store-04": "pending", "store-05": "pending",
  "store-06": "completed", "store-07": "pending", "store-08": "pending", "store-09": "completed", "store-10": "pending",
};

export const refillRequests: RefillRequest[] = [
  { id: "RF-260920-01", storeId: "store-02", requestedAt: "2026-09-20T08:20:00+07:00", status: "waiting", cheeseQty: 42, mangoQty: 44, note: "ຮ້ານໂທແຈ້ງວ່າສິນຄ້າໃກ້ໝົດ" },
  { id: "RF-260920-02", storeId: "store-05", requestedAt: "2026-09-20T09:05:00+07:00", status: "waiting", cheeseQty: 45, mangoQty: 41 },
  { id: "RF-260920-03", storeId: "store-07", requestedAt: "2026-09-20T10:30:00+07:00", status: "delivering", cheeseQty: 39, mangoQty: 43 },
];

export const demoSettlements: DemoSettlement[] = [
  { id: "ST-2026-000121", storeId: "store-01", periodLabel: "14–20 ກ.ຍ. 2026", cheeseSold: 38, mangoSold: 42, gross: 1600000, commission: 480000, net: 1120000, paid: 1120000, paymentMethod: "bank", status: "paid" },
  { id: "ST-2026-000122", storeId: "store-03", periodLabel: "14–20 ກ.ຍ. 2026", cheeseSold: 31, mangoSold: 26, gross: 1140000, commission: 342000, net: 798000, paid: 600000, paymentMethod: "cash", status: "partial" },
  { id: "ST-2026-000123", storeId: "store-06", periodLabel: "14–20 ກ.ຍ. 2026", cheeseSold: 22, mangoSold: 25, gross: 940000, commission: 282000, net: 658000, paid: 658000, paymentMethod: "cash", status: "paid" },
  { id: "ST-2026-000124", storeId: "store-09", periodLabel: "14–20 ກ.ຍ. 2026", cheeseSold: 29, mangoSold: 33, gross: 1240000, commission: 372000, net: 868000, paid: 0, paymentMethod: "bank", status: "pending" },
];

export const rawMaterials: RawMaterialDemo[] = [
  { id: "rm-cream", name: "ວິບຄຣີມ", unit: "L", stock: 18, minStock: 8, avgCost: 0, category: "ingredient" },
  { id: "rm-condensed", name: "ນົມຂົ້ນຫວານ", unit: "kg", stock: 9.4, minStock: 4, avgCost: 0, category: "ingredient" },
  { id: "rm-milkpowder", name: "ນົມຜົງ", unit: "kg", stock: 12.5, minStock: 5, avgCost: 0, category: "ingredient" },
  { id: "rm-sugar", name: "ນ້ຳຕານ", unit: "kg", stock: 16.8, minStock: 6, avgCost: 0, category: "ingredient" },
  { id: "rm-cheese", name: "ຜົງລົດນົມຊີສ", unit: "kg", stock: 1.25, minStock: 0.5, avgCost: 0, category: "ingredient" },
  { id: "rm-mango", name: "ຜົງລົດໝາກມ່ວງ", unit: "kg", stock: 0.82, minStock: 0.5, avgCost: 0, category: "ingredient" },
  { id: "rm-probiotic", name: "ຜົງຈຸລິນຊີ No.1", unit: "ຊອງ", stock: 76, minStock: 40, avgCost: 0, category: "ingredient" },
  { id: "rm-cupset", name: "ຊຸດຖ້ວຍ + ຝາ + ບ່ວງ", unit: "ຊຸດ", stock: 1280, minStock: 500, avgCost: 0, category: "packaging" },
];

export const monthlyExpenses = [
  { label: "ຄ່າໄຟຕູ້ແຊ່ 10 ຮ້ານ", amount: 2000000, category: "electricity" },
  { label: "ຄ່ານ້ຳມັນ / ຂົນສົ່ງ", amount: 780000, category: "fuel" },
  { label: "ຄ່າໃຊ້ຈ່າຍອື່ນໆ", amount: 320000, category: "other" },
];

export function formatLak(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} LAK`;
}

export function getStore(storeId: string) {
  return demoStores.find((store) => store.id === storeId);
}

export function getStoreFridge(storeId: string) {
  return demoFridges.find((fridge) => fridge.storeId === storeId);
}

export function getStoreInventory(storeId: string) {
  return demoInventory
    .filter((line) => line.storeId === storeId)
    .map((line) => ({ ...line, product: demoProducts.find((product) => product.id === line.productId)! }));
}
