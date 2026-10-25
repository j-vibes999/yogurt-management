import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { decimalAtScale } from "@/lib/stock-validation";
const schema=z.object({code:z.string().trim().min(1).max(40),name:z.string().trim().min(1).max(120),category:z.enum(["ingredient","packaging"]),unit:z.string().trim().min(1).max(30),minStock:z.coerce.number().nonnegative().default(0),avgCostPerUnit:z.coerce.number().nonnegative().default(0)});
export async function POST(request:Request){
  const session=await getCurrentSession();if(!session||session.role!=="admin")return NextResponse.json({error:"ບໍ່ມີສິດເຮັດລາຍການນີ້",retryable:false},{status:403});
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"ຂໍ້ມູນວັດຖຸດິບບໍ່ຖືກຕ້ອງ",retryable:false},{status:400});
  const data=parsed.data;const minStock=decimalAtScale(data.minStock,3),cost=decimalAtScale(data.avgCostPerUnit,4);
  if(!minStock||!cost)return NextResponse.json({error:"ຈຳນວນ ຫຼືລາຄາລະອຽດເກີນໄປ",retryable:false},{status:400});
  try{const result=await withSerializableTransaction(tx=>runIdempotentOperation(tx,{key:request.headers.get("Idempotency-Key"),userId:session.userId,scope:"material_create",payload:data},async()=>{
    const x=await tx.rawMaterial.create({data:{code:data.code,name:data.name,category:data.category,unit:data.unit,minStockAlert:minStock,avgCostPerUnit:cost}});
    await writeAuditLog({userId:session.userId,action:"create",entityType:"raw_material",entityId:x.id,summary:`ສ້າງວັດຖຸດິບ ${x.name}`},tx);
    return {material:{id:x.id,code:x.code,name:x.name,category:x.category,unit:x.unit,minStock:Number(x.minStockAlert),cost:Number(x.avgCostPerUnit),isActive:x.isActive}};
  }));return NextResponse.json(result,{status:201});}
  catch(error){const code=error instanceof Error?error.message:"";if(code==="IDEMPOTENCY_KEY_REQUIRED"||code==="INVALID_IDEMPOTENCY_KEY")return NextResponse.json({error:"ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ",retryable:false},{status:400});if(code==="IDEMPOTENCY_CONFLICT"||(error as {code?:string}).code==="P2002")return NextResponse.json({error:"ລະຫັດວັດຖຸດິບ ຫຼືລາຍການນີ້ມີແລ້ວ",retryable:false},{status:409});console.error("[materials] create failed",error);return NextResponse.json({error:"ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງຄືນ",retryable:true},{status:503});}
}
