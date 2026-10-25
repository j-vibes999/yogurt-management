import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { ExpenseEditForm } from "@/components/expense-management";
import { getExpensesData, getStoreOptions } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ExpenseEditPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  const { id } = await params;
  const [{ source, expenses }, { stores }] = await Promise.all([getExpensesData({id}), getStoreOptions()]);
  const expense = expenses.find((item) => item.id === id);
  if (!expense) notFound();

  return (
    <>
      <div className="page workspace-color-page color-domain-finance form-page">
        <div className="page-header color-page-header"><div><div className="eyebrow">ແກ້ໄຂລາຍຈ່າຍ</div><h1>ແກ້ໄຂລາຍຈ່າຍ</h1><p>ການລຶບລາຍຈ່າຍຈະໃຊ້ວິທີຍົກເລີກລາຍການ ເພື່ອຮັກສາປະຫວັດການແກ້ໄຂ; ໜ້ານີ້ໃຊ້ສຳລັບແກ້ຂໍ້ມູນທີ່ຍັງໃຊ້ງານ.</p></div></div>
        {source === "demo" && <div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br />ເບິ່ງໄດ້ແຕ່ຍັງບັນທຶກບໍ່ໄດ້.</div>}
        <ExpenseEditForm
          enabled={source === "database"}
          stores={stores.map(({ id: storeId, name }) => ({ id: storeId, name }))}
          expense={{ id: expense.id, category: expense.category, amount: expense.amount, incurredAt: expense.incurredAtIso.slice(0,10), storeId: expense.storeId, storeName: expense.storeName, note: expense.note, receiptUrl: expense.receiptUrl }}
        />
      </div>
    </>
  );
}
