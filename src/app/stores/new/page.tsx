import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { StoreCreateForm } from "@/components/crud-forms";
import { getStoresData } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewStorePage(){
  noStore();const {source}=await getStoresData();return <><div className="page form-page workspace-color-page color-domain-stores"><Link href="/stores" className="muted" style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: "inline-block" }}>← ກັບໜ້າຮ້ານຄ້າ</Link><div className="page-header color-page-header"><div><div className="eyebrow">ຕັ້ງຄ່າຮ້ານ</div><h1>ເພີ່ມຮ້ານໃໝ່</h1><p>ສ້າງຮ້ານ, ຜູກຕູ້ແຊ່ ແລະກຳນົດຈຸດຂາຍໃນຂັ້ນຕອນດຽວ.</p></div></div>{source==="demo"&&<div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br/>ຟອມນີ້ຈະບັນທຶກໄດ້ຫຼັງຈາກຕັ້ງຄ່າ PostgreSQL ສຳເລັດ.</div>}<StoreCreateForm enabled={source==="database"}/></div></>;
}
