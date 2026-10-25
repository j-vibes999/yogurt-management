import { NextResponse } from "next/server";
import { z } from "zod";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { decimalAtScale } from "@/lib/stock-validation";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";

const schema=z.object({
  code:z.string().trim().min(1).max(40).optional(), name:z.string().trim().min(1).max(120).optional(),
  category:z.enum(["ingredient","packaging"]).optional(), unit:z.string().trim().min(1).max(30).optional(),
  avgCostPerUnit:z.coerce.number().nonnegative().optional(), minStock:z.coerce.number().nonnegative().optional(), isActive:z.boolean().optional()
}).refine(v=>Object.keys(v).length>0);
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 const session=await getCurrentSession(); if(!session||session.role!=="admin")return NextResponse.json({error:"ບໍ່ມີສິດເຮັດລາຍການນີ້"},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:"ຂໍ້ມູນວັດຖຸດິບບໍ່ຖືກຕ້ອງ",retryable:false},{status:400});
 const{id}=await params;const d=parsed.data;
 const cost=d.avgCostPerUnit===undefined?undefined:decimalAtScale(d.avgCostPerUnit,4);const minStock=d.minStock===undefined?undefined:decimalAtScale(d.minStock,3);
 if(cost===null||minStock===null)return NextResponse.json({error:"ຈຳນວນ ຫຼືລາຄາລະອຽດເກີນໄປ",retryable:false},{status:400});
 try{const result=await withSerializableTransaction(tx=>runIdempotentOperation(tx,{key:request.headers.get("Idempotency-Key"),userId:session.userId,scope:"material_update",payload:{id,...d}},async()=>{
   const before=await tx.rawMaterial.findUnique({where:{id}});if(!before)throw new Error("MATERIAL_NOT_FOUND");
   if(d.unit&&d.unit!==before.unit){
     const [purchase,recipe,adjustment]=await Promise.all([tx.purchaseOrderItem.findFirst({where:{rawMaterialId:id},select:{id:true}}),tx.recipeItem.findFirst({where:{rawMaterialId:id},select:{id:true}}),tx.rawMaterialAdjustment.findFirst({where:{rawMaterialId:id},select:{id:true}})]);
     if(Number(before.currentStock)!==0||purchase||recipe||adjustment)throw new Error("UNIT_IN_USE");
   }
   const after=await tx.rawMaterial.update({where:{id},data:{...(d.code?{code:d.code}:{}),...(d.name?{name:d.name}:{}),...(d.category?{category:d.category}:{}),...(d.unit?{unit:d.unit}:{}),...(cost===undefined?{}:{avgCostPerUnit:cost}),...(minStock===undefined?{}:{minStockAlert:minStock}),...(d.isActive===undefined?{}:{isActive:d.isActive})}});
   const view=(x:typeof after)=>({id:x.id,code:x.code,name:x.name,category:x.category,unit:x.unit,minStock:Number(x.minStockAlert),cost:Number(x.avgCostPerUnit),isActive:x.isActive});
   await writeAuditLog({userId:session.userId,action:"update",entityType:"raw_material",entityId:id,summary:`ແກ້ໄຂວັດຖຸດິບ ${after.name}`,metadata:{before:view(before),after:view(after)}},tx);
   return {material:view(after)};
 }));return NextResponse.json(result);}
 catch(error){const code=error instanceof Error?error.message:"";
   if(code==="MATERIAL_NOT_FOUND")return NextResponse.json({error:"ບໍ່ພົບວັດຖຸດິບ",retryable:false},{status:404});
   if(code==="UNIT_IN_USE")return NextResponse.json({error:"ວັດຖຸດິບນີ້ມີສະຕັອກ ຫຼືປະຫວັດແລ້ວ; ສ້າງວັດຖຸດິບໃໝ່ເມື່ອປ່ຽນໜ່ວຍ",retryable:false},{status:409});
   if(code==="IDEMPOTENCY_KEY_REQUIRED"||code==="INVALID_IDEMPOTENCY_KEY")return NextResponse.json({error:"ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ",retryable:false},{status:400});
   if(code==="IDEMPOTENCY_CONFLICT"||(error as {code?:string}).code==="P2002")return NextResponse.json({error:"ລະຫັດ ຫຼືລາຍການນີ້ມີແລ້ວ",retryable:false},{status:409});
   console.error("[materials] update failed",error);return NextResponse.json({error:"ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງຄືນ",retryable:true},{status:503});
 }
}
