import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/server-session";
import { expenseFilter } from "@/lib/db-data";
import { businessDateString } from "@/lib/date-only";

export const dynamic="force-dynamic";
const cell=(value:unknown)=>{const text=String(value??"");return `"${(/^[=+@\-\t\r]/.test(text)?"'":"")+text.replace(/"/g,'""')}"`;};
export async function GET(request:Request) {
  const session=await getCurrentSession();
  if(!session)return Response.json({error:"Unauthorized"},{status:401});
  if(session.role!=="admin")return Response.json({error:"Forbidden"},{status:403});
  const url=new URL(request.url);const where=await expenseFilter({query:url.searchParams.get("q")??"",filter:url.searchParams.get("filter")??"all"});
  const encoder=new TextEncoder();let cursor:string|undefined,cancelled=false;
  const stream=new ReadableStream({
    start(controller){controller.enqueue(encoder.encode("\uFEFF"+["Date","Category","Amount","Store","Note"].map(cell).join(",")+"\n"));},
    async pull(controller){
      try{
        const rows=await prisma.expense.findMany({where,orderBy:{id:"asc"},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{store:{select:{name:true}}}});
        if(cancelled)return;
        if(!rows.length){controller.close();return;}
        controller.enqueue(encoder.encode(rows.map(row=>[businessDateString(row.incurredAt),row.category,row.amount.toFixed(2),row.store?.name??"",row.note??""].map(cell).join(",")).join("\n")+"\n"));
        cursor=rows.at(-1)!.id;
      }catch(error){if(!cancelled)controller.error(error);}
    },
    cancel(){cancelled=true;},
  });
  return new Response(stream,{headers:{"Content-Type":"text/csv;charset=utf-8","Content-Disposition":'attachment; filename="yogurt-expenses.csv"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
