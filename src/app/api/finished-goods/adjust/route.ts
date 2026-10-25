import { NextResponse } from "next/server";
import { withSerializableTransaction } from "@/lib/transaction";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { runIdempotentOperation } from "@/lib/idempotency";
import { parseWholeCount } from "@/lib/money";

export async function POST(request: Request) {
  const session=await getCurrentSession();
  if(!session||!["admin","production"].includes(session.role)) return NextResponse.json({error:"ບໍ່ມີສິດເຮັດລາຍການນີ້",retryable:false},{status:403});
  const body=await request.json().catch(()=>null);
  const batchId=typeof body?.batchId==="string"?body.batchId.trim():"";
  const quantity=parseWholeCount(body?.quantity);
  const reason=typeof body?.reason==="string"?body.reason.trim():"";
  const note=typeof body?.note==="string"?body.note.trim():"";
  if(!batchId||quantity===null||quantity<=0||quantity>100000||!reason||reason.length>200||note.length>1000) return NextResponse.json({error:"ກະລຸນາເລືອກລັອດຜະລິດ, ໃສ່ຈຳນວນເຕັມ ແລະເຫດຜົນ",retryable:false},{status:400});
  try {
    const result=await withSerializableTransaction(tx=>runIdempotentOperation(tx,{key:request.headers.get("Idempotency-Key"),userId:session.userId,scope:"finished_goods_adjust",payload:{batchId,quantity,reason,note}},async()=>{
      const batch=await tx.productionBatch.findUnique({where:{id:batchId}});
      if(!batch||batch.status!=="completed") throw new Error("BATCH_NOT_FOUND");
      if(quantity>batch.quantityRemaining) throw new Error("INSUFFICIENT_BATCH_STOCK");
      await tx.productionBatch.update({where:{id:batch.id},data:{quantityRemaining:{decrement:quantity}}});
      // Keep the batch unit cost with the write-off so reports can subtract the loss.
      const adjustment=await tx.finishedGoodsAdjustment.create({data:{productionBatchId:batch.id,finishedProductId:batch.finishedProductId,quantity,reason,note:note||null,createdById:session.userId,unitCost:batch.unitCost,costKnown:batch.costKnown}});
      await writeAuditLog({userId:session.userId,action:"waste",entityType:"production_batch",entityId:batch.id,summary:reason+" · "+quantity+" cups · "+batch.batchNumber,metadata:{quantity,reason,note,beforeStock:batch.quantityRemaining,afterStock:batch.quantityRemaining-quantity}},tx);
      return {id:adjustment.id};
    }));
    return NextResponse.json(result,{status:201});
  } catch(error) {
    const code=error instanceof Error?error.message:"";
    if(code==="BATCH_NOT_FOUND") return NextResponse.json({error:"ບໍ່ພົບລັອດຜະລິດ",retryable:false},{status:404});
    if(code==="INSUFFICIENT_BATCH_STOCK"||code==="IDEMPOTENCY_CONFLICT") return NextResponse.json({error:"ສິນຄ້າບໍ່ພໍ ຫຼືລາຍການປ່ຽນແປງ; ກະລຸນາໂຫຼດຄືນ",retryable:false},{status:409});
    if(code==="IDEMPOTENCY_KEY_REQUIRED"||code==="INVALID_IDEMPOTENCY_KEY") return NextResponse.json({error:"ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ",retryable:false},{status:400});
    console.error("[waste] transaction failed",error);
    return NextResponse.json({error:"ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ",retryable:true},{status:503});
  }
}
