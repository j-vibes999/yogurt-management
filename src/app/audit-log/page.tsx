import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/prisma";
import { AuditDirectory } from "@/components/audit-directory";
import { CsvExportButton } from "@/components/csv-export-button";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const actionLabel: Record<string,string>={create:"ສ້າງ",update:"ແກ້ໄຂ",delete:"ລຶບ",complete:"ສຳເລັດ",adjust:"ປັບຈຳນວນ",receive:"ຮັບເຂົ້າ",void:"ຍົກເລີກ",create_user:"ສ້າງຜູ້ໃຊ້",close_day:"ປິດຍອດປະຈຳວັນ",status:"ປ່ຽນສະຖານະ",waste:"ບັນທຶກຂອງເສຍ",recipe_version:"ສ້າງສະບັບສູດ"};
const entityLabel:Record<string,string>={raw_material:"ວັດຖຸດິບ",finished_product:"ສິນຄ້າ",product:"ສິນຄ້າ",user:"ຜູ້ໃຊ້",expense:"ລາຍຈ່າຍ",fridge:"ຕູ້ແຊ່",store:"ຮ້ານ",settlement:"ການຮັບເງິນ",refill_request:"ຄຳຂໍເຕີມສິນຄ້າ",restock_visit:"ຮອບກວດຮ້ານ",production_batch:"ລັອດຜະລິດ",purchase_order:"ການຮັບວັດຖຸດິບ",recipe:"ສູດ",daily_closing:"ການປິດຍອດປະຈຳວັນ"};
const fieldLabel:Record<string,string>={code:"ລະຫັດ",name:"ຊື່",category:"ປະເພດ",unit:"ຫົວໜ່ວຍ",minStock:"ຈຸດແຈ້ງເຕືອນ",cost:"ຕົ້ນທຶນ",isActive:"ສະຖານະເປີດໃຊ້",sizeDescription:"ຂະໜາດ",retailPrice:"ລາຄາຂາຍ",shelfLifeDays:"ອາຍຸສິນຄ້າ",fullName:"ຊື່",role:"ບົດບາດ",passwordReset:"ປ່ຽນລະຫັດຜ່ານ",status:"ສະຖານະ",capacityCups:"ຄວາມຈຸ",currentStoreId:"ຮ້ານປັດຈຸບັນ",stock:"ຈຳນວນຄົງເຫຼືອ",balance:"ຍອດຄົງຄ້າງ",delta:"ຈຳນວນທີ່ປ່ຽນ",reason:"ເຫດຜົນ",note:"ໝາຍເຫດ",amount:"ຈຳນວນເງິນ",storeId:"ຮ້ານ",receiptUrl:"ຫຼັກຖານ",assetCode:"ລະຫັດຕູ້",before:"ກ່ອນແກ້ໄຂ",after:"ຫຼັງແກ້ໄຂ",object:"ລາຍການ",items:"ລາຍການສິນຄ້າ",productId:"ສິນຄ້າ",quantity:"ຈຳນວນ",paymentMethod:"ວິທີຮັບເງິນ"};
const valueLabel:Record<string,string>={true:"ແມ່ນ",false:"ບໍ່ແມ່ນ",active:"ປົກກະຕິ",maintenance:"ບຳລຸງຮັກສາ",waiting:"ລໍຖ້າ",preparing:"ກຳລັງຈັດ",delivering:"ກຳລັງສົ່ງ",completed:"ສຳເລັດ",cancelled:"ຍົກເລີກ",admin:"ຜູ້ດູແລລະບົບ",production:"ຝ່າຍຜະລິດ",driver:"ພະນັກງານສົ່ງ",ingredient:"ສ່ວນປະກອບ",packaging:"ບັນຈຸພັນ",electricity:"ຄ່າໄຟ",fuel:"ຄ່ານ້ຳມັນ",transport:"ຄ່າຂົນສົ່ງ",other:"ອື່ນໆ",manual_add:"ເພີ່ມດ້ວຍມື",manual_remove:"ຫັກອອກດ້ວຍມື",stock:"ຈຳນວນຄົງເຫຼືອ",chinese:"ອື່ນໆ",cash:"ເງິນສົດ",bank:"ເງິນໂອນ"};
function text(v:unknown):string{if(v===null||v===undefined||v==="")return "—";if(typeof v==="boolean")return v?"ແມ່ນ":"ບໍ່ແມ່ນ";if(typeof v==="number")return v.toLocaleString();if(Array.isArray(v))return `${v.length} ລາຍການ`;if(typeof v==="object")return Object.entries(v as Record<string,unknown>).map(([k,val])=>`${fieldLabel[k]??k}: ${text(val)}`).join(", ");const raw=String(v);return valueLabel[raw]??raw}
function summaryLabel(s:string){return s
 .replace(/^Create material /,"ສ້າງວັດຖຸດິບ ").replace(/^Update material /,"ແກ້ໄຂວັດຖຸດິບ ")
 .replace(/^Create product /,"ສ້າງສິນຄ້າ ").replace(/^Update product /,"ແກ້ໄຂສິນຄ້າ ")
 .replace(/^Create user /,"ສ້າງຜູ້ໃຊ້ ").replace(/^Update user /,"ແກ້ໄຂຜູ້ໃຊ້ ")
 .replace(/^New recipe version /,"ສ້າງສະບັບສູດໃໝ່ ").replace(/^Daily closing /,"ປິດຍອດປະຈຳວັນ ")
 .replace(/^Void ລາຍຈ່າຍ/,"ຍົກເລີກລາຍຈ່າຍ").replace(/^Refill → waiting$/,"ເຕີມສິນຄ້າ → ລໍຖ້າ").replace(/^Refill → preparing$/,"ເຕີມສິນຄ້າ → ກຳລັງຈັດ").replace(/^Refill → delivering$/,"ເຕີມສິນຄ້າ → ກຳລັງສົ່ງ").replace(/^Refill → completed$/,"ເຕີມສິນຄ້າ → ສຳເລັດ").replace(/Stock /g,"ຈຳນວນຄົງເຫຼືອ ").replace(/stock/g,"ຈຳນວນຄົງເຫຼືອ").replace(/ manual_add/g," ເພີ່ມດ້ວຍມື").replace(/ manual_remove/g," ຫັກອອກດ້ວຍມື").replace(/ other$/g," ອື່ນໆ").replace(/ · admin$/g," · ຜູ້ດູແລລະບົບ").replace(/ຈາກ chinese/g,"ຈາກ ຈີນ")}
function Diff({metadata}:{metadata:unknown}){
 if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))return null;
 const m=metadata as Record<string,unknown>; const before=m.before,after=m.after;
 if(before&&after&&typeof before==="object"&&typeof after==="object"&&!Array.isArray(before)&&!Array.isArray(after)){
  const b=before as Record<string,unknown>,a=after as Record<string,unknown>; const keys=[...new Set([...Object.keys(b),...Object.keys(a)])].filter(k=>JSON.stringify(b[k])!==JSON.stringify(a[k]));
  if(!keys.length)return null;
  return <div className="audit-diff-v1">{keys.map(k=><span key={k}><b>{fieldLabel[k]??k}</b>: {text(b[k])} → {text(a[k])}</span>)}</div>;
 }
 return <small className="audit-diff-v1">{Object.entries(m).map(([k,v])=>`${fieldLabel[k]??k}: ${text(v)}`).join(" · ")}</small>;
}
export default async function AuditLogPage({searchParams}:{searchParams?:Promise<{page?:string;q?:string;filter?:string}>}){
 noStore();
 const params=await searchParams;
 const requested=Math.max(1,Number.parseInt(params?.page??"1",10)||1);
 const query=(params?.q??"").trim().slice(0,120);
 const allowedFilters=new Set(["all","update","adjust","expense","user"]);
 const filter=allowedFilters.has(params?.filter??"all")?(params?.filter??"all"):"all";
 const and:Prisma.AuditLogWhereInput[]=[];
 if(filter==="update"||filter==="adjust")and.push({action:filter});
 else if(filter==="expense"||filter==="user")and.push({entityType:{contains:filter,mode:"insensitive"}});
 if(query)and.push({OR:[
  {summary:{contains:query,mode:"insensitive"}},
  {entityType:{contains:query,mode:"insensitive"}},
  {store:{is:{name:{contains:query,mode:"insensitive"}}}},
  {user:{is:{fullName:{contains:query,mode:"insensitive"}}}},
 ]});
 const where:Prisma.AuditLogWhereInput|undefined=and.length?{AND:and}:undefined;
 const pageSize=50;
 const [total,logs]=await Promise.all([
  prisma.auditLog.count({where}),
  prisma.auditLog.findMany({where,orderBy:{createdAt:"desc"},skip:(requested-1)*pageSize,take:pageSize,include:{user:{select:{fullName:true,role:true}},store:{select:{name:true}}}}),
 ]);
 const totalPages=Math.max(1,Math.ceil(total/pageSize));
 if(requested>totalPages) {
  const next=new URLSearchParams();
  next.set("page",String(totalPages));
  if(query)next.set("q",query);
  if(filter!=="all")next.set("filter",filter);
  redirect(`/audit-log?${next.toString()}`);
 }
 const page=requested;
 const pageHref=(nextPage:number)=>{const next=new URLSearchParams();next.set("page",String(nextPage));if(query)next.set("q",query);if(filter!=="all")next.set("filter",filter);return `/audit-log?${next.toString()}`};
 return <div className="page workspace-color-page color-domain-operations audit-log-page-v5"><div className="page-header color-page-header"><div><div className="eyebrow">ປະຫວັດລະບົບ</div><h1>ປະຫວັດການເຮັດລາຍການ</h1><p>ຄົ້ນຫາຕາມຮ້ານ, ຜູ້ໃຊ້ ຫຼືປະເພດການປ່ຽນແປງ.</p></div><div className="page-actions"><CsvExportButton filename={`yogurt-audit-page-${page}`} headers={["Date","Action","Summary","Entity","Store","User"]} rows={logs.map(log=>[new Intl.DateTimeFormat("lo-LA",{dateStyle:"medium",timeStyle:"short"}).format(log.createdAt),actionLabel[log.action]??log.action,summaryLabel(log.summary),entityLabel[log.entityType]??log.entityType,log.store?.name??"",log.user?.fullName??"ລະບົບ"])}/></div></div><AuditDirectory logs={logs.map(log=>({id:log.id,actionKey:log.action,actionLabel:actionLabel[log.action]??log.action,summary:summaryLabel(log.summary),entityType:entityLabel[log.entityType]??log.entityType,storeName:log.store?.name??"",userName:log.user?.fullName??"ລະບົບ",createdAt:new Intl.DateTimeFormat("lo-LA",{dateStyle:"medium",timeStyle:"short"}).format(log.createdAt),diff:<Diff metadata={log.metadata}/>}))} total={total} query={query} filter={filter}/><nav className="audit-pagination-v37" aria-label="ປ່ຽນໜ້າປະຫວັດ"><span>{total.toLocaleString()} ລາຍການ · ໜ້າ {page}/{totalPages}</span><div>{page>1?<Link prefetch={false} className="button button-ghost" href={pageHref(page-1)}>← ກ່ອນໜ້າ</Link>:<span className="button button-ghost is-disabled">← ກ່ອນໜ້າ</span>}{page<totalPages?<Link prefetch={false} className="button button-secondary" href={pageHref(page+1)}>ຕໍ່ໄປ →</Link>:<span className="button button-secondary is-disabled">ຕໍ່ໄປ →</span>}</div></nav></div>
}
