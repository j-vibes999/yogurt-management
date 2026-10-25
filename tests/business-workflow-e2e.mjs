import assert from 'node:assert/strict';
import { PrismaClient, Prisma } from '@prisma/client';
import { execFileSync } from 'node:child_process';

const base=process.env.E2E_BASE_URL||'http://127.0.0.1:3101';
const database=new URL(process.env.DATABASE_URL);
assert.ok(/^yogurt_(?:e2e|fix)_/.test(database.pathname.slice(1)),"Business E2E is restricted to temporary databases");
const origin=new URL(base);assert.ok(["127.0.0.1","localhost"].includes(origin.hostname)&&["3101","3121"].includes(origin.port),"Business E2E is restricted to local test servers");
const prisma=new PrismaClient();

async function jsonFetch(path, options={}) {
  if(options.method&&!["GET","HEAD"].includes(options.method))options={...options,headers:{"Idempotency-Key":crypto.randomUUID(),...options.headers}};
  const r=await fetch(base+path,options);
  const text=await r.text();
  let body=null; try { body=text?JSON.parse(text):null; } catch { body=text; }
  return {r,body};
}

async function main(){
  const email=(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const password=process.env.ADMIN_PASSWORD||'';
  assert.ok(email&&password,'ADMIN_EMAIL and ADMIN_PASSWORD are required');
  const login=await jsonFetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(login.r.status,200,'login must succeed');
  const cookie=login.r.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie,'session cookie required');
  const headers={cookie,'content-type':'application/json'};

  const weakCreate=await jsonFetch('/api/users',{method:'POST',headers,body:JSON.stringify({email:'weak-policy@example.test',fullName:'Weak Policy Test',password:'a'.repeat(14),role:'driver'})});
  assert.equal(weakCreate.r.status,400,'creating a user with a short password must be rejected');
  const admin=await prisma.user.findUniqueOrThrow({where:{email}});
  const weakReset=await jsonFetch(`/api/users/${admin.id}`,{method:'PATCH',headers,body:JSON.stringify({password:'a'.repeat(14)})});
  assert.equal(weakReset.r.status,400,'resetting a password to a short value must be rejected');

  const sessionEmail=`session-reset-${crypto.randomUUID()}@example.test`;
  const firstPassword=crypto.randomUUID()+crypto.randomUUID();
  const secondPassword=crypto.randomUUID()+crypto.randomUUID();
  const thirdPassword=crypto.randomUUID()+crypto.randomUUID();
  const sessionUser=await jsonFetch('/api/users',{method:'POST',headers,body:JSON.stringify({email:sessionEmail,fullName:'Session Reset Test',password:firstPassword,role:'admin'})});
  assert.equal(sessionUser.r.status,201,'session reset test user must be created in the clone');
  const loginSessionUser=async(password)=>{
    const result=await jsonFetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:sessionEmail,password})});
    assert.equal(result.r.status,200,'session test login must succeed');
    const sessionCookie=result.r.headers.get('set-cookie')?.split(';')[0];
    assert.ok(sessionCookie,'session test cookie required');
    return sessionCookie;
  };
  const firstCookie=await loginSessionUser(firstPassword);
  const reset=await jsonFetch(`/api/users/${sessionUser.body.id}`,{method:'PATCH',headers,body:JSON.stringify({password:secondPassword})});
  assert.equal(reset.r.status,200,'API password reset must succeed');
  const revoked=await fetch(base+'/api/session',{headers:{cookie:firstCookie}});
  assert.equal(revoked.status,401,'API password reset must revoke the earlier session');
  const revokedPage=await fetch(base+'/reports',{headers:{cookie:firstCookie},redirect:'manual'});
  assert.equal(revokedPage.status,307,'revoked session must return to login');
  assert.equal(new URL(revokedPage.headers.get('location'),base).pathname,'/login');
  const revokedWrite=await jsonFetch(`/api/users/${sessionUser.body.id}`,{method:'PATCH',headers:{cookie:firstCookie,'content-type':'application/json'},body:JSON.stringify({fullName:'Unexpected Update'})});
  assert.equal(revokedWrite.r.status,401,'revoked session must not change a user');
  for(const path of ['/api/search?q=Sa','/api/map/search?q=','/api/notifications/count']){
    assert.equal((await fetch(base+path,{headers:{cookie:firstCookie}})).status,401,`${path} must reject a revoked session`);
  }
  const revokedMetric=await fetch(base+'/api/metrics/web-vitals',{method:'POST',headers:{cookie:firstCookie,'content-type':'application/json'},body:JSON.stringify({name:'LCP',value:1,path:'/'})});
  assert.equal(revokedMetric.status,401,'revoked session must not write metrics');
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:sessionUser.body.id}})).fullName,'Session Reset Test');
  const secondCookie=await loginSessionUser(secondPassword);
  assert.equal((await fetch(base+'/api/session',{headers:{cookie:secondCookie}})).status,200,'new password must issue a working session');
  execFileSync(process.execPath,['scripts/set-admin-password.mjs'],{env:{...process.env,ADMIN_EMAIL:sessionEmail,ADMIN_PASSWORD:thirdPassword},stdio:'pipe'});
  assert.equal((await fetch(base+'/api/session',{headers:{cookie:secondCookie}})).status,401,'CLI password reset must revoke the earlier session');
  const thirdCookie=await loginSessionUser(thirdPassword);
  assert.equal((await fetch(base+'/api/session',{headers:{cookie:thirdCookie}})).status,200,'CLI reset password must issue a working session');
  assert.equal((await fetch(base+'/api/session',{headers:{cookie}})).status,200,'resetting one user must keep another user session working');

  const product=await prisma.finishedProduct.findFirst({
    where:{isActive:true,recipes:{some:{isDefault:true}}},
    include:{recipes:{where:{isDefault:true},orderBy:{version:'desc'},take:1,include:{items:{include:{rawMaterial:true}}}}},
  });
  assert.ok(product?.recipes[0]?.items.length,'active product with recipe required');
  const recipe=product.recipes[0];
  const receiveTarget=recipe.items[0].rawMaterial;
  const receiveBefore=Number(receiveTarget.currentStock);
  const receive=await jsonFetch('/api/inventory/receive',{method:'POST',headers,body:JSON.stringify({supplierName:'E2E Supplier',rawMaterialId:receiveTarget.id,quantity:1,unitPrice:Number(receiveTarget.avgCostPerUnit||0),note:'E2E cloned DB'})});
  assert.equal(receive.r.status,201,`inventory receive must succeed: ${JSON.stringify(receive.body)}`);
  const receiveAfter=await prisma.rawMaterial.findUniqueOrThrow({where:{id:receiveTarget.id}});
  assert.ok(Math.abs(Number(receiveAfter.currentStock)-(receiveBefore+1))<1e-6,'inventory receive must increment stock exactly');
  const refreshedItems=await prisma.recipeItem.findMany({where:{recipeId:recipe.id},include:{rawMaterial:true}});
  const before=new Map(refreshedItems.map(i=>[i.rawMaterialId,Number(i.rawMaterial.currentStock)]));
  const prod=await jsonFetch('/api/production-batches',{method:'POST',headers,body:JSON.stringify({productId:product.id,cups:1})});
  assert.equal(prod.r.status,201,`production must succeed: ${JSON.stringify(prod.body)}`);
  const batch=await prisma.productionBatch.findUnique({where:{id:prod.body.id}}); assert.equal(batch?.quantityProduced,1);
  for(const item of refreshedItems){
    const material=await prisma.rawMaterial.findUniqueOrThrow({where:{id:item.rawMaterialId}});
    const expected=before.get(item.rawMaterialId)-Number(item.quantityRequired)/recipe.baseCups;
    assert.ok(Math.abs(Number(material.currentStock)-expected)<1e-6,`material ${material.name} must decrement exactly`);
    assert.ok(Number(material.currentStock)>=0,`material ${material.name} must stay non-negative`);
  }

  const store=await prisma.store.findFirst({where:{isActive:true,fridge:{isNot:null}},include:{fridge:true,fridgeInventory:true}}); assert.ok(store?.fridge,'active store with fridge required');
  const refill=await jsonFetch('/api/refills',{method:'POST',headers,body:JSON.stringify({storeId:store.id,note:'E2E cloned DB',items:[{finishedProductId:product.id,quantity:1}]})});
  assert.equal(refill.r.status,201,`refill must succeed: ${JSON.stringify(refill.body)}`);
  const refillRow=await prisma.refillRequest.findUnique({where:{id:refill.body.id},include:{items:true}});
  assert.equal(refillRow?.status,'waiting'); assert.equal(refillRow?.items.length,1); assert.equal(refillRow?.items[0].quantity,1);
  const forbiddenClose=await jsonFetch(`/api/stores/${store.id}`,{method:'PATCH',headers,body:JSON.stringify({name:store.name,isActive:false})});
  assert.equal(forbiddenClose.r.status,409,'PATCH must not deactivate a store with an open refill');
  const forbiddenDelete=await jsonFetch(`/api/stores/${store.id}`,{method:'DELETE',headers});
  assert.equal(forbiddenDelete.r.status,409,'DELETE must enforce the same close guard');
  const stockTotal=store.fridgeInventory.reduce((sum,row)=>sum+row.currentStock,0);
  if(stockTotal>1){
    const tooSmall=await jsonFetch(`/api/fridges/${store.fridge.id}`,{method:'PATCH',headers,body:JSON.stringify({capacityCups:stockTotal-1})});
    assert.equal(tooSmall.r.status,409,'fridge capacity cannot fall below stock on hand');
  }

  assert.ok(store.fridgeInventory.length,'store must have fridge inventory for restock audit');
  const sellable=store.fridgeInventory.find(x=>x.currentStock>0) ?? store.fridgeInventory[0];
  const restockLines=store.fridgeInventory.map(x=>({productId:x.finishedProductId,previousStock:x.currentStock,countRemaining:x.id===sellable.id?Math.max(0,x.currentStock-1):x.currentStock,countExpiredReturned:0,countRefilled:0}));
  const restockKey=crypto.randomUUID();
  const restockBody=JSON.stringify({storeId:store.id,fridgeAssetCode:store.fridge.assetCode,lines:restockLines,paidAmount:0});
  const restock=await jsonFetch('/api/restock-visits',{method:'POST',headers:{...headers,'Idempotency-Key':restockKey},body:restockBody});
  assert.equal(restock.r.status,201,`driver restock must succeed: ${JSON.stringify(restock.body)}`);
  const restockRetry=await jsonFetch('/api/restock-visits',{method:'POST',headers:{...headers,'Idempotency-Key':restockKey},body:restockBody});
  assert.equal(restockRetry.r.status,201,'retrying an accepted restock must succeed without another visit');
  assert.equal(restockRetry.body.visitId,restock.body.visitId);
  assert.equal(await prisma.restockVisit.count({where:{id:restock.body.visitId}}),1);
  const restockRow=await prisma.restockVisit.findFirst({where:{storeId:store.id},orderBy:{visitDate:'desc'}}); assert.ok(restockRow,'restock visit must be persisted');
  const settlementAfterRestock=await prisma.settlement.findFirst({where:{storeId:store.id},orderBy:{settlementDate:'desc'}}); assert.ok(settlementAfterRestock,'restock must produce settlement');
  assert.equal(await prisma.auditLog.count({where:{entityType:'restock_visit',entityId:restock.body.visitId}}),1,'restock and audit entry must commit together');

  const payable=await prisma.store.findFirst({
    where:{isActive:true,fridge:{isNot:null},settlements:{some:{closingBalance:{gt:0}}}},
    include:{settlements:{orderBy:{settlementDate:'desc'},take:1}},
  });
  if(payable){
    const balance=Number(payable.settlements[0].closingBalance); const amount=Math.min(1,balance);
    const paymentKey=crypto.randomUUID();
    const paymentBody=JSON.stringify({storeId:payable.id,paidAmount:amount,paymentMethod:'cash'});
    const pay=await jsonFetch('/api/settlements/pay',{method:'POST',headers:{...headers,'Idempotency-Key':paymentKey},body:paymentBody});
    assert.equal(pay.r.status,201,`payment must succeed: ${JSON.stringify(pay.body)}`);
    assert.equal(Number(pay.body.closingBalance),balance-amount);
    assert.equal(await prisma.auditLog.count({where:{entityType:'settlement',entityId:pay.body.settlementId}}),1,'payment and audit entry must commit together');
    const retry=await jsonFetch('/api/settlements/pay',{method:'POST',headers:{...headers,'Idempotency-Key':paymentKey},body:paymentBody});
    assert.equal(retry.r.status,201,'retrying an accepted payment must succeed without another write');
    assert.equal(retry.body.settlementId,pay.body.settlementId);
    assert.equal(await prisma.settlement.count({where:{receiptNumber:pay.body.receiptNumber}}),1);
    const over=await jsonFetch('/api/settlements/pay',{method:'POST',headers:{...headers,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({storeId:payable.id,paidAmount:Number(pay.body.closingBalance)+1,paymentMethod:'cash'})});
    assert.equal(over.r.status,400,'overpayment must be rejected');
    if (Number(pay.body.closingBalance) >= 2) {
      const raceAmount=Number(pay.body.closingBalance);
      const [a,b]=await Promise.all([
        jsonFetch('/api/settlements/pay',{method:'POST',headers:{...headers,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({storeId:payable.id,paidAmount:raceAmount,paymentMethod:'cash'})}),
        jsonFetch('/api/settlements/pay',{method:'POST',headers:{...headers,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({storeId:payable.id,paidAmount:raceAmount,paymentMethod:'cash'})}),
      ]);
      const statuses=[a.r.status,b.r.status].sort();
      assert.deepEqual(statuses,[201,400],'concurrent duplicate full payments must yield one success and one rejection');
      const latest=await prisma.settlement.findFirst({where:{storeId:payable.id},orderBy:{settlementDate:'desc'}});
      assert.ok(latest && Number(latest.closingBalance)>=0,'concurrent payment must never make balance negative');
    }
  } else {
    console.log('Settlement scenario skipped: no store with outstanding balance in clone');
  }

  await prisma.fridge.update({where:{id:store.fridge.id},data:{status:'maintenance'}});
  const delivering=await jsonFetch(`/api/refills/${refill.body.id}`,{method:'PATCH',headers,body:JSON.stringify({status:'delivering'})});
  assert.equal(delivering.r.status,200);
  const blockedDelivery=await jsonFetch(`/api/refills/${refill.body.id}`,{method:'PATCH',headers,body:JSON.stringify({status:'completed'})});
  assert.equal(blockedDelivery.r.status,409,'refill cannot complete into a maintenance fridge');
  assert.equal((await prisma.refillRequest.findUniqueOrThrow({where:{id:refill.body.id}})).status,'delivering');

  const almostDue=new Date(Date.now()-7*24*60*60*1000+60*60*1000);
  await prisma.restockVisit.updateMany({where:{storeId:store.id,status:'completed'},data:{visitDate:almostDue}});
  const storesForDue=await prisma.store.findMany({where:{isActive:true},include:{restockVisits:{where:{status:'completed'},orderBy:{visitDate:'desc'},take:1}}});
  const dueCutoff=Date.now()-7*24*60*60*1000;
  const expectedDue=storesForDue.filter(item=>!item.restockVisits[0]||item.restockVisits[0].visitDate.getTime()<dueCutoff).length;
  const navCounts=await jsonFetch('/api/nav-counts',{headers:{cookie}});
  const shellState=await jsonFetch('/api/shell-state',{headers:{cookie}});
  assert.equal(navCounts.r.status,200);
  assert.equal(shellState.r.status,200);
  assert.equal(navCounts.body.driver,expectedDue,'navigation must not mark a visit due seven hours early');
  assert.equal(shellState.body.navCounts.driver,expectedDue,'shell must use the same UTC visit deadline');

  const localParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Vientiane',year:'numeric',month:'numeric'}).formatToParts(new Date());
  const localYear=Number(localParts.find(x=>x.type==='year').value),localMonth=Number(localParts.find(x=>x.type==='month').value);
  const monthStart=new Date(Date.UTC(localYear,localMonth-1,1)-7*60*60*1000);
  const nextMonth=new Date(Date.UTC(localYear,localMonth,1)-7*60*60*1000);
  const monthWhere={settlementDate:{gte:monthStart,lt:nextMonth}};
  // A sale and expense in the first local hour must remain in this month's report.
  const firstLocalHour=new Date(monthStart.getTime()+60*60*1000);
  await prisma.settlement.update({where:{restockVisitId:restock.body.visitId},data:{settlementDate:firstLocalHour}});
  await prisma.expense.create({data:{storeId:store.id,category:'transport',amount:123,incurredAt:firstLocalHour,note:'E2E month boundary'}});
  const expectedExpenses=await prisma.expense.aggregate({where:{voidedAt:null,incurredAt:{gte:monthStart,lt:nextMonth}},_sum:{amount:true}});
  const boundaryReport=await fetch(base+'/reports?period=month',{headers:{cookie}});
  assert.equal(boundaryReport.status,200);
  const expensesText=new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(expectedExpenses._sum.amount||0))+' LAK';
  assert.ok((await boundaryReport.text()).includes(`<span>ລາຍຈ່າຍ</span><strong>${expensesText}</strong>`),'monthly report must include expenses in the first local hour');
  const monthlySales=await prisma.settlement.findMany({where:monthWhere,include:{restockVisit:{include:{items:true}}}});
  const mixed=monthlySales.find(row=>row.restockVisit.items.filter(item=>item.unitsSold>0).length>=2);
  if(mixed){
    const sold=mixed.restockVisit.items.filter(item=>item.unitsSold>0);
    await prisma.restockVisitItem.update({where:{id:sold[0].id},data:{subtotalCost:12345,costKnown:null,unknownCostUnits:null}});
    await prisma.restockVisitItem.update({where:{id:sold[1].id},data:{subtotalCost:0,costKnown:null,unknownCostUnits:null}});
    const refreshed=await prisma.settlement.findMany({where:monthWhere,include:{restockVisit:{include:{items:true}}}});
    const expectedCost=refreshed.reduce((sum,row)=>{
      const items=row.restockVisit.items;
      if(items.length===0&&Number(row.grossAmount)>0)return sum+Number(new Prisma.Decimal(row.grossAmount).mul('0.28').toDecimalPlaces(2));
      return sum+items.reduce((lineSum,item)=>{
        if(item.unitsSold<=0)return lineSum;
        const cost=item.unknownCostUnits!==null
          ?new Prisma.Decimal(item.subtotalCost).add(new Prisma.Decimal(item.retailPrice).mul(item.unknownCostUnits).mul('0.28').toDecimalPlaces(2))
          :Number(item.subtotalCost)>0?item.subtotalCost:new Prisma.Decimal(item.subtotalGross).mul('0.28').toDecimalPlaces(2);
        return lineSum+Number(cost);
      },0);
    },0);
    const report=await fetch(base+'/reports?period=month',{headers:{cookie}});
    assert.equal(report.status,200);
    const expectedText=new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(expectedCost)+' LAK';
    assert.ok((await report.text()).includes(`<span>ຕົ້ນທຶນສິນຄ້າ</span><strong>${expectedText}</strong>`),'report must estimate missing cost per sold item');
  }

  const topStore = await prisma.settlement.groupBy({where:monthWhere,by:['storeId'],_sum:{grossAmount:true},orderBy:{_sum:{grossAmount:'desc'}},take:1});
  if(topStore[0] && Number(topStore[0]._sum.grossAmount)>0){
    const inactive=await prisma.store.update({where:{id:topStore[0].storeId},data:{isActive:false}});
    const report=await fetch(base+'/reports?period=month',{headers:{cookie}});
    assert.equal(report.status,200);
    assert.ok((await report.text()).includes(inactive.name),'reports must include sales from a deactivated store');
  }

  const adminEmail=(process.env.ADMIN_EMAIL||'owner@yogurt.local').trim().toLowerCase();
  const adminBefore=await prisma.user.findUnique({where:{email:adminEmail}});
  const countsBefore={stores:await prisma.store.count(),settlements:await prisma.settlement.count()};
  const stockBefore=(await prisma.fridgeInventory.findUniqueOrThrow({where:{id:sellable.id}})).currentStock;
  execFileSync(process.execPath,['--env-file=.env','scripts/seed-if-empty.mjs'],{env:process.env});
  execFileSync(process.execPath,['--env-file=.env','scripts/ensure-admin-password.mjs'],{env:process.env});
  assert.deepEqual({stores:await prisma.store.count(),settlements:await prisma.settlement.count()},countsBefore,'setup cannot reseed operational rows');
  assert.equal((await prisma.fridgeInventory.findUniqueOrThrow({where:{id:sellable.id}})).currentStock,stockBefore,'setup must preserve live stock');
  if(adminBefore?.passwordHash.startsWith('scrypt$')){
    const adminAfter=await prisma.user.findUniqueOrThrow({where:{email:adminEmail}});
    assert.equal(adminAfter.passwordHash,adminBefore.passwordHash,'setup must preserve an existing admin password');
  }

  for (const page of ['/reports','/audit-log']) {
    const response=await fetch(base+page,{headers:{cookie},redirect:'manual'});
    assert.equal(response.status,200,`${page} must render after workflow mutations`);
  }
  const auditCount=await prisma.auditLog.count({where:{summary:{contains:'E2E'}}});
  assert.ok(auditCount>=1,'workflow should leave auditable records');

  const negativeRaw=await prisma.rawMaterial.count({where:{currentStock:{lt:0}}});
  const negativeFridge=await prisma.fridgeInventory.count({where:{currentStock:{lt:0}}});
  assert.equal(negativeRaw,0); assert.equal(negativeFridge,0);
  console.log('Business workflow E2E passed on cloned database');
}

main().finally(()=>prisma.$disconnect());
