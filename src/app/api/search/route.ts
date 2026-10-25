import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  const [stores, fridges, batches, settlements, materials, products] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true, OR: [{ name: { contains: q, mode: "insensitive" } }, { contactName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] }, select: { id: true, name: true, address: true }, take: 6 }),
    prisma.fridge.findMany({ where: { OR: [{ assetCode: { contains: q, mode: "insensitive" } }, { serialNo: { contains: q, mode: "insensitive" } }] }, select: { id: true, assetCode: true, currentStore: { select: { name: true } } }, take: 4 }),
    prisma.productionBatch.findMany({ where: { batchNumber: { contains: q, mode: "insensitive" } }, select: { id: true, batchNumber: true, finishedProduct: { select: { name: true } } }, take: 4 }),
    prisma.settlement.findMany({ where: { receiptNumber: { contains: q, mode: "insensitive" } }, select: { id: true, receiptNumber: true, store: { select: { name: true } } }, take: 4 }),
    prisma.rawMaterial.findMany({ where: { isActive:true, OR:[{name:{contains:q,mode:"insensitive"}},{code:{contains:q,mode:"insensitive"}}] }, select:{id:true,name:true,code:true,unit:true}, take:5 }),
    prisma.finishedProduct.findMany({ where: { isActive:true, OR:[{name:{contains:q,mode:"insensitive"}},{code:{contains:q,mode:"insensitive"}}] }, select:{id:true,name:true,code:true}, take:5 }),
  ]);
  const needle=q.toLowerCase();
  const actions=[
    {id:"action-expense",type:"ຄຳສັ່ງ",title:"+ ບັນທຶກລາຍຈ່າຍ",detail:"ສ້າງລາຍຈ່າຍໃໝ່",href:"/expenses/new",keys:["expense","ລາຍຈ່າຍ",]},
    {id:"action-refill",type:"ຄຳສັ່ງ",title:"+ ສ້າງຄຳຂໍເຕີມສິນຄ້າ",detail:"ສ້າງຄຳຂໍເຕີມສິນຄ້າ",href:"/refills/new",keys:["refill","ເຕີມ"]},
    {id:"action-store",type:"ຄຳສັ່ງ",title:"+ ເພີ່ມຮ້ານ",detail:"ສ້າງຮ້ານໃໝ່",href:"/stores/new",keys:["store","ຮ້ານ",]},
    {id:"action-receive",type:"ຄຳສັ່ງ",title:"+ ຮັບວັດຖຸດິບ",detail:"ຮັບວັດຖຸດິບເຂົ້າສາງ",href:"/inventory/receive",keys:["receive","ຮັບວັດຖຸດິບ"]},
    {id:"action-production",type:"ຄຳສັ່ງ",title:"ໄປການຜະລິດ",detail:"ສ້າງລັອດການຜະລິດ",href:"/production",keys:["production","ຜະລິດ"]},
  ].filter(a=>a.title.toLowerCase().includes(needle)||a.keys.some(k=>k.includes(needle)||needle.includes(k))).slice(0,4);
  return NextResponse.json({ results: [
    ...actions,
    ...stores.map((x) => ({ id: `store-${x.id}`, type: "ຮ້ານ", title: x.name, detail: x.address ?? "", href: `/stores/${x.id}` })),
    ...fridges.map((x) => ({ id: `fridge-${x.id}`, type: "ຕູ້ແຊ່", title: x.assetCode, detail: x.currentStore?.name ?? "ຍັງບໍ່ຜູກຮ້ານ", href: "/fridges" })),
    ...batches.map((x) => ({ id: `batch-${x.id}`, type: "ລັອດຜະລິດ", title: x.batchNumber, detail: x.finishedProduct.name, href: "/production" })),
    ...settlements.map((x) => ({ id: `settlement-${x.id}`, type: "ບິນ", title: x.receiptNumber ?? x.id, detail: x.store.name, href: "/settlements" })),
    ...materials.map((x)=>({id:`material-${x.id}`,type:"ວັດຖຸດິບ",title:x.name,detail:`${x.code} · ${x.unit}`,href:"/inventory"})),
    ...products.map((x)=>({id:`product-${x.id}`,type:"ສິນຄ້າ",title:x.name,detail:x.code,href:"/production"})),
  ]});
}
