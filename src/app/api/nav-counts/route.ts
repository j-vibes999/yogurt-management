import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/server-session";
export async function GET(){
 const session=await getCurrentSession(); if(!session)return NextResponse.json({error:"ບໍ່ມີສິດເຂົ້າໃຊ້"},{status:401});
 const [refill,lowRows,outRows,dueRows]=await Promise.all([
  prisma.refillRequest.count({where:{status:{in:["waiting","preparing","delivering"]}}}),
  prisma.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM raw_materials WHERE is_active=true AND current_stock <= min_stock_alert`,
  prisma.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM (SELECT DISTINCT ON (store_id) store_id,closing_balance FROM settlements ORDER BY store_id,settlement_date DESC,id DESC) x WHERE closing_balance>0`,
  prisma.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM stores s LEFT JOIN LATERAL (SELECT visit_date FROM restock_visits r WHERE r.store_id=s.id AND r.status='completed' ORDER BY visit_date DESC LIMIT 1) v ON true WHERE s.is_active=true AND (v.visit_date IS NULL OR v.visit_date < (NOW() AT TIME ZONE 'UTC')-INTERVAL '7 days')`,
 ]);
 return NextResponse.json({refill,inventory:Number(lowRows[0]?.count??0),settlements:Number(outRows[0]?.count??0),driver:Number(dueRows[0]?.count??0)});
}
