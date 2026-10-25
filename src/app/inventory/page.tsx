import Link from "next/link";
import { InventoryDirectory } from "@/components/inventory-directory";
import { CsvExportButton } from "@/components/csv-export-button";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InventoryPage() {
  noStore();
  const rows = await prisma.rawMaterial.findMany({ where:{isActive:true}, orderBy:{name:"asc"} });
  const materials = rows.map((item)=>({id:item.id,code:item.code,name:item.name,category:item.category,unit:item.unit,stock:Number(item.currentStock),minStock:Number(item.minStockAlert),avgCost:Number(item.avgCostPerUnit)}));
  const critical = materials.filter((item)=>item.stock <= item.minStock);

  return <div className="page workflow-page workflow-inventory inventory-simple-v19 workspace-color-page color-domain-materials">
    <div className="page-header color-page-header">
      <div><div className="eyebrow">ວັດຖຸດິບ</div><h1>ວັດຖຸດິບຄົງເຫຼືອ</h1><p>ກວດຈຳນວນ ແລະກົດ “ຈັດການ” ເພື່ອແກ້ຈຳນວນຄົງເຫຼືອ ຫຼືລາຄາ.</p></div>
      <div className="page-actions"><CsvExportButton filename="yogurt-inventory" headers={["Code","Name","Category","Unit","Stock","Min stock","Average cost"]} rows={materials.map(x=>[x.code,x.name,x.category,x.unit,x.stock,x.minStock,x.avgCost])}/><Link prefetch={false} className="button button-primary" href="/inventory/receive">+ ຮັບວັດຖຸດິບ</Link></div>
    </div>

    {critical.length > 0 && <div className="inventory-alert-v4"><strong>{critical.length} ລາຍການຕ່ຳກວ່າຈຸດຕ່ຳສຸດ</strong><span>{critical.slice(0,4).map((item)=>item.name).join(" · ")}{critical.length > 4 ? ` · +${critical.length-4}` : ""}</span><Link prefetch={false} href="/inventory/receive">ຮັບເຂົ້າ →</Link></div>}

    <div className="card panel-card inventory-table-card-v4 color-panel">
      <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ຈຳນວນຄົງເຫຼືອ</span><h2>ລາຍການທັງໝົດ</h2></div><span className="store-meta">{materials.length} ລາຍການ</span></div>
      <InventoryDirectory materials={materials}/>
    </div>
  </div>;
}
