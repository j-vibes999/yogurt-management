import { unstable_noStore as noStore } from "next/cache";
import { RefillCreateForm } from "@/components/crud-forms";
import { getStoresData } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewRefillPage({ searchParams }: { searchParams?: Promise<{ storeId?: string | string[] }> }) {
  noStore();
  const [{ source, stores }, products, query] = await Promise.all([
    getStoresData(),
    prisma.finishedProduct.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    searchParams,
  ]);
  const storeOptions = stores.filter((store) => store.fridge).map(({ id, name }) => ({ id, name }));
  const requestedStoreId = typeof query?.storeId === "string" ? query.storeId.trim() : "";
  const initialStoreId = storeOptions.some((store) => store.id === requestedStoreId) ? requestedStoreId : "";
  const storeSelectionNotice = query?.storeId !== undefined && !initialStoreId
    ? "ຮ້ານຈາກລິງນີ້ບໍ່ພ້ອມເຕີມສິນຄ້າ. ຮ້ານອາດຖືກປິດ ຫຼືຍັງບໍ່ຜູກຕູ້ແຊ່. ກະລຸນາເລືອກຮ້ານອີກຄັ້ງ."
    : undefined;

  return <div className="page form-page workspace-color-page color-domain-refills">
    <div className="page-header color-page-header"><div><div className="eyebrow">ເຕີມສິນຄ້າ</div><h1>ສ້າງຄຳຂໍເຕີມສິນຄ້າ</h1><p>ເລືອກຮ້ານ ແລະລະບຸຈຳນວນສິນຄ້າທີ່ຕ້ອງຈັດສົ່ງ.</p></div></div>
    {source === "demo" && <div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br />ຍັງບໍ່ສາມາດສ້າງຄິວຈິງໄດ້.</div>}
    <RefillCreateForm key={initialStoreId} enabled={source === "database"} stores={storeOptions} products={products} initialStoreId={initialStoreId} storeSelectionNotice={storeSelectionNotice} />
  </div>;
}
