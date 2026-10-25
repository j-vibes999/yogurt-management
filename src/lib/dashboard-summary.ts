import type { DashboardData, NotificationView } from "./db-data";

export type DashboardAttentionItem = {
  key: "due-stores" | "refills" | "materials" | "receivables" | "expiring" | "maintenance";
  label: string;
  href: string;
  tone: NotificationView["type"];
  value?: number;
  unit?: "ຮ້ານ" | "ຄຳຂໍ" | "ລາຍການ" | "LAK";
  detail: string;
};

type AttentionData = Pick<DashboardData, "dueStores" | "refills" | "lowMaterials" | "outstanding">;

/** Summarize each category once using complete dashboard totals, before any display limit. */
export function getDashboardAttentionSummary(data: AttentionData, alerts: readonly NotificationView[]): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];
  const pendingRefills = data.refills.filter((refill) => refill.status === "waiting" || refill.status === "preparing").length;

  if (data.dueStores > 0) {
    items.push({
      key: "due-stores",
      label: "ຮ້ານຮອດຮອບກວດ",
      href: "/driver",
      tone: "urgent",
      value: data.dueStores,
      unit: "ຮ້ານ",
      detail: "ຮອດຮອບກວດຕູ້ແຊ່ ແລະສິນຄ້າທີ່ຮ້ານ",
    });
  }

  if (pendingRefills > 0) {
    items.push({
      key: "refills",
      label: "ຄຳຂໍເຕີມສິນຄ້າ",
      href: "/refills",
      tone: "urgent",
      value: pendingRefills,
      unit: "ຄຳຂໍ",
      detail: "ລໍຖ້າ ຫຼື ກຳລັງຈັດສິນຄ້າ",
    });
  }

  if (data.lowMaterials.length > 0) {
    items.push({
      key: "materials",
      label: "ວັດຖຸດິບໃກ້ຈຸດສັ່ງຊື້",
      href: "/inventory",
      tone: "warning",
      value: data.lowMaterials.length,
      unit: "ລາຍການ",
      detail: "ລາຍການສະຕັອກທີ່ຄວນຈັບຕາ ແລະວາງແຜນສັ່ງຊື້",
    });
  }

  if (data.outstanding > 0) {
    items.push({
      key: "receivables",
      label: "ຍອດຄ້າງຮັບ",
      href: "/settlements",
      tone: "warning",
      value: data.outstanding,
      unit: "LAK",
      detail: "ຄິດຈາກຍອດຄົງຄ້າງຫຼ້າສຸດຂອງແຕ່ລະຮ້ານ",
    });
  }

  // Production batches and fridge totals are outside DashboardData; their alerts already carry the complete category title.
  for (const key of ["expiring", "maintenance"] as const) {
    const alert = alerts.find((item) => item.id === key);
    if (alert) {
      items.push({ key, label: alert.title, href: alert.href, tone: alert.type, detail: alert.detail });
    }
  }

  return items;
}
