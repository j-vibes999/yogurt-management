import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Archive, Database, ExternalLink, MapPinned, Refrigerator, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { MasterDataManagement } from "@/components/master-data-management";
import { RecipeManager } from "@/components/recipe-manager";
import { SectionTabs } from "@/components/section-tabs";
import { ClosingForm } from "@/components/operations-forms";
import { loadBackupReadiness } from "@/lib/backup-readiness";
import { ResponsiveDisclosure } from "@/components/responsive-disclosure";

export const dynamic="force-dynamic";
export const revalidate=0;

async function getLatestBackup(){
  try{
    const dir=path.join(process.cwd(),".yogurt","backups");
    const names=(await readdir(dir)).filter(name=>name.endsWith(".dump"));
    const rows=await Promise.all(names.map(async name=>({name,info:await stat(path.join(dir,name))})));
    rows.sort((a,b)=>b.info.mtimeMs-a.info.mtimeMs);
    const latest=rows[0];
    if(!latest)return null;
    return {name:latest.name,date:latest.info.mtime.toLocaleString("lo-LA"),sizeMb:(latest.info.size/1024/1024).toFixed(2)};
  }catch{return null;}
}

export default async function OperationsPage(){
  noStore();
  const [recipes,materials,products,fridges,latestBackup,backupReadiness]=await Promise.all([
    prisma.recipe.findMany({where:{isDefault:true},include:{finishedProduct:true,items:{include:{rawMaterial:true}}}}),
    prisma.rawMaterial.findMany({orderBy:{name:"asc"}}),
    prisma.finishedProduct.findMany({orderBy:{name:"asc"}}),
    prisma.fridge.findMany({select:{id:true,status:true}}),
    getLatestBackup(),
    loadBackupReadiness(process.cwd(),process.env.DATABASE_URL??""),
  ]);

  const activeProducts=products.filter(x=>x.isActive).length;
  const activeFridges=fridges.filter(x=>x.status==="active").length;
  const activeMaterials=materials.filter(x=>x.isActive).length;
  const masterProps={
    materials:materials.map(x=>({id:x.id,code:x.code,name:x.name,category:x.category,unit:x.unit,minStock:Number(x.minStockAlert),cost:Number(x.avgCostPerUnit),isActive:x.isActive})),
    products:products.map(x=>({id:x.id,code:x.code,name:x.name,sizeDescription:x.sizeDescription,retailPrice:Number(x.retailPrice),shelfLifeDays:x.shelfLifeDays,isActive:x.isActive})),
    users:[],
  };
  const recipeProps={
    products:products.map(p=>{const r=recipes.find(x=>x.finishedProductId===p.id);return {id:p.id,name:p.name,code:p.code,recipe:r?{id:r.id,name:r.name,baseCups:r.baseCups,version:r.version,items:r.items.map(i=>({rawMaterialId:i.rawMaterialId,quantity:Number(i.quantityRequired)}))}:undefined}}),
    materials:materials.filter(m=>m.isActive).map(m=>({id:m.id,name:m.name,unit:m.unit})),
  };

  return <div className="page workspace-color-page color-domain-operations operations-hub-v43">
    <header className="operations-header-v43 color-page-header">
      <div>
        <div className="eyebrow">ສູນຈັດການ</div>
        <h1>ຈັດການລະບົບ</h1>
        <p>ຈັດການສິນຄ້າ, ວັດຖຸດິບ ແລະສູດການຜະລິດ. ປິດຍອດປະຈຳວັນໄດ້ດ້ານລຸ່ມ.</p>
      </div>
      <div className="operations-health-v43" data-readiness={backupReadiness.ok?"ready":"warning"} aria-label="ສະຖານະລະບົບ">
        <span className="operations-health-dot-v43" aria-hidden="true"/>
        <span>{backupReadiness.ok?"ລະບົບປົກກະຕິ":"ກວດກາການສຳຮອງຂໍ້ມູນ"}</span>
      </div>
    </header>

    <main className="operations-workspace-v43 color-panel" id="master-data">
      <div className="operations-workspace-head-v43 color-panel-heading">
        <div>
          <span className="panel-kicker">ວຽກຫຼັກ</span>
          <h2>ຂໍ້ມູນຫຼັກ</h2>
          <p>ເລືອກໝວດຂໍ້ມູນທີ່ຕ້ອງການຈັດການ.</p>
        </div>
        <div className="operations-workspace-counts-v43" aria-label="ສະຫຼຸບຂໍ້ມູນຫຼັກ">
          <span><strong>{activeProducts}</strong> ສິນຄ້າ</span>
          <span><strong>{activeMaterials}</strong> ວັດຖຸດິບ</span>
          <span><strong>{recipes.length}</strong> ສູດ</span>
        </div>
      </div>
      <SectionTabs defaultKey="products" tabs={[
        {key:"products",label:"ສິນຄ້າ",content:<MasterDataManagement {...masterProps} view="products"/>},
        {key:"materials",label:"ວັດຖຸດິບ",content:<MasterDataManagement {...masterProps} view="materials"/>},
        {key:"recipes",label:"ສູດການຜະລິດ",content:<RecipeManager {...recipeProps}/>},
      ]}/>
    </main>

    <ResponsiveDisclosure title="ປິດຍອດປະຈຳວັນ" summary="ບັນທຶກເງິນສົດ, ເງິນໂອນ ແລະລາຍຈ່າຍ" className="color-domain-finance">
      <ClosingForm/>
    </ResponsiveDisclosure>

    <section className="operations-secondary-v43" aria-label="ເຄື່ອງມື ແລະສະຖານະລະບົບ">
      <div className="operations-tools-v43 color-panel">
        <div className="operations-section-head-v43 color-panel-heading">
          <div><span className="panel-kicker">ເຄື່ອງມື</span><h2>ໄປໜ້າອື່ນ</h2></div>
          <p>ເປີດເມື່ອຕ້ອງຈັດການອຸປະກອນ ຫຼືກວດສອບລະບົບ.</p>
        </div>
        <div className="operations-tool-list-v43">
          <Link href="/fridges"><span className="operations-tool-icon-v43"><Refrigerator size={19} aria-hidden="true"/></span><span><strong>ຕູ້ແຊ່</strong><small>ຈັດການອຸປະກອນ ແລະສະຖານະຕູ້</small></span><ExternalLink size={16} aria-hidden="true"/></Link>
          <Link href="/map"><span className="operations-tool-icon-v43"><MapPinned size={19} aria-hidden="true"/></span><span><strong>ແຜນທີ່ຮ້ານ</strong><small>ເບິ່ງຕຳແໜ່ງຮ້ານ ແລະຕູ້ແຊ່</small></span><ExternalLink size={16} aria-hidden="true"/></Link>
          <Link href="/audit-log"><span className="operations-tool-icon-v43"><ShieldCheck size={19} aria-hidden="true"/></span><span><strong>ປະຫວັດລະບົບ</strong><small>ກວດກາການປ່ຽນແປງ ແລະ activity</small></span><ExternalLink size={16} aria-hidden="true"/></Link>
        </div>
      </div>

      <aside className="operations-overview-v43 color-panel">
        <div className="operations-section-head-v43 color-panel-heading">
          <div><span className="panel-kicker">ພາບລວມ</span><h2>ລະບົບ</h2></div>
        </div>
        <div className="operations-overview-grid-v43">
          <div className="color-metric-domain color-domain-refills"><span>ສິນຄ້າ</span><strong>{activeProducts}</strong><small>{products.length} ທັງໝົດ</small></div>
          <div className="color-metric-domain color-domain-materials"><span>ວັດຖຸດິບ</span><strong>{activeMaterials}</strong><small>ເປີດໃຊ້</small></div>
          <div className="color-metric-domain color-domain-refills"><span>ສູດ</span><strong>{recipes.length}</strong><small>ກຳລັງໃຊ້</small></div>
          <div className="color-metric-domain color-domain-stores"><span>ຕູ້ແຊ່</span><strong>{activeFridges}</strong><small>{fridges.length} ທັງໝົດ</small></div>
        </div>
        <div className="operations-status-v43">
          <div><span><Database size={15} aria-hidden="true"/>PostgreSQL</span><strong>Connected</strong></div>
          <div><span><Archive size={15} aria-hidden="true"/>Backup</span><strong className={backupReadiness.ok?undefined:"is-warning"}>{backupReadiness.ok?"ກູ້ຄືນໄດ້":backupReadiness.restoreVerified?"ຕ້ອງກວດກາ":"ຍັງບໍ່ຢືນຢັນການກູ້ຄືນ"}</strong></div>
        </div>
        {latestBackup&&<div className="operations-backup-v43"><span>Backup ຫຼ້າສຸດ</span><strong>{latestBackup.date}</strong><small>{latestBackup.sizeMb} MB</small></div>}
      </aside>
    </section>
  </div>;
}
