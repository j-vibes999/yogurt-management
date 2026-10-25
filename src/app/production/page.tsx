import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { ProductionPlanner } from "@/components/production-planner";
import { ProductionBatchDirectory } from "@/components/production-batch-directory";
import { ResponsiveDisclosure } from "@/components/responsive-disclosure";
import { WasteForm } from "@/components/operations-forms";
import { getProductionData } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ historyPage?: string }> }) {
  noStore();
  const params = await searchParams;
  const pageNumber = Number(params.historyPage);
  const requestedPage = params.historyPage ? (Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1) : undefined;
  const { source, batches, adjustmentBatches, totalBatches, pageCount, historyPage, centralStockTotal } = await getProductionData({ historyPage: requestedPage });
  const [materialStocks, recipeProducts] = source === "database" ? await Promise.all([
    prisma.rawMaterial.findMany({ where:{isActive:true}, select: { id:true,name: true, currentStock: true, unit: true, avgCostPerUnit: true } }),
    prisma.finishedProduct.findMany({ where:{isActive:true}, orderBy:{name:"asc"}, include:{recipes:{where:{isDefault:true},orderBy:{version:"desc"},take:1,include:{items:{include:{rawMaterial:true}}}}} })
  ]) : [[],[]];
  const plannerRecipes = recipeProducts.flatMap(product=>product.recipes[0]?[{productId:product.id,productName:product.name,code:product.code,baseCups:product.recipes[0].baseCups,version:product.recipes[0].version,items:product.recipes[0].items.map(item=>({rawMaterialId:item.rawMaterialId,name:item.rawMaterial.name,quantity:Number(item.quantityRequired),unit:item.rawMaterial.unit}))}]:[]);
  const activeBatches = batches.filter((batch) => batch.quantityRemaining > 0);

  return (
    <>
      <div className="page workflow-page workflow-production workspace-color-page color-domain-refills">
        <div className="page-header color-page-header">
          <div>
            <div className="eyebrow">ຜະລິດມື້ນີ້</div>
            <h1>ການຜະລິດ</h1>
            <p>ເລືອກສິນຄ້າ ແລະຈຳນວນທີ່ຈະຜະລິດ.</p>
          </div>
        </div>

        {source === "demo" && <div className="notice" style={{ marginBottom: 16 }}><strong>ໂໝດສາທິດ</strong><br />ການສ້າງ ລັອດການຜະລິດ ແລະຫັກວັດຖຸດິບຈິງຈະເປີດເມື່ອ PostgreSQL ເຮັດວຽກ.</div>}

        <div className="workflow-primary-v1"><div className="panel-kicker" style={{marginBottom:8}}>ຜະລິດມື້ນີ້</div><ProductionPlanner enabled={source === "database"} materialStocks={materialStocks.map((item) => ({ id:item.id,name: item.name, stock: Number(item.currentStock), unit: item.unit, avgCostPerUnit: Number(item.avgCostPerUnit) }))} recipes={plannerRecipes} /></div>

        <details className="responsive-disclosure-v33">
          <summary><span><strong>ຂອງເສຍ / ໝົດອາຍຸ</strong><small>ຫັກສິນຄ້າທີ່ເສຍຫາຍ ຫຼືໝົດອາຍຸຈາກສາງກາງ</small></span></summary>
          <div className="responsive-disclosure-content-v33"><WasteForm enabled={source === "database"} batches={adjustmentBatches.map(batch => ({ id: batch.id, label: `${batch.batchNumber} · ${batch.productName}`, remaining: batch.quantityRemaining }))}/></div>
        </details>

        <ResponsiveDisclosure title={historyPage ? "ປະຫວັດລັອດຜະລິດ" : "ລັອດທີ່ມີສິນຄ້າຄົງເຫຼືອ"} summary={historyPage ? `${totalBatches} ລັອດ · ໜ້າ ${historyPage}/${pageCount}` : `${activeBatches.length} ລັອດ · ${centralStockTotal} ຖ້ວຍທີ່ຍັງບໍ່ໝົດອາຍຸ`} className="production-history-disclosure-v33">
          <div className="card panel-card production-batch-card-v4 color-panel">
            <div className="panel-head color-panel-heading">
              <div><span className="panel-kicker">ສິນຄ້າສຳເລັດຮູບ</span><h2>ລັອດຜະລິດ ແລະວັນໝົດອາຍຸ</h2></div>
              <Link className="button button-secondary" href={historyPage ? "/production" : "/production?historyPage=1"}>{historyPage ? "ລັອດຄົງເຫຼືອ" : "ເບິ່ງປະຫວັດທັງໝົດ"}</Link>
            </div>
            <ProductionBatchDirectory key={historyPage ? "history" : "active"} batches={batches} paginated={Boolean(historyPage)} />
            {historyPage && pageCount > 1 && <nav className="form-actions" aria-label="ໜ້າປະຫວັດລັອດ">
              {historyPage > 1 && <Link className="button button-secondary" href={`/production?historyPage=${historyPage - 1}`}>ກ່ອນໜ້າ</Link>}
              <span>ໜ້າ {historyPage}/{pageCount}</span>
              {historyPage < pageCount && <Link className="button button-secondary" href={`/production?historyPage=${historyPage + 1}`}>ຖັດໄປ</Link>}
            </nav>}
          </div>
        </ResponsiveDisclosure>
      </div>
    </>
  );
}
