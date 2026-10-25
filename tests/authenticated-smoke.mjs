import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

function parseUrl(value, label) {
  try { return new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
}
const database=parseUrl(process.env.DATABASE_URL,'DATABASE_URL');
const databaseName=decodeURIComponent(database.pathname.slice(1));
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
assert.ok(/^yogurt_(?:e2e|fix)_[a-z0-9_]+$/i.test(databaseName),'Authenticated smoke is restricted to temporary databases');
assert.ok(['postgres:','postgresql:'].includes(database.protocol)&&loopback.has(database.hostname),'Authenticated smoke database must be local PostgreSQL');
const origin=parseUrl(process.env.E2E_BASE_URL||'http://127.0.0.1:3121','E2E_BASE_URL');
assert.ok(origin.protocol==='http:'&&loopback.has(origin.hostname)&&['3101','3121'].includes(origin.port),'Authenticated smoke is restricted to local test servers on port 3101 or 3121');
assert.ok(origin.pathname==='/'&&!origin.search&&!origin.hash&&!origin.username&&!origin.password,'E2E_BASE_URL must be a test-server origin');
const prisma=new PrismaClient();
let materialId,productId;

// Headers preserves explicit keys regardless of their casing or input form.
async function request(route,options={}) {
  const method=(options.method||'GET').toUpperCase();
  const headers=new Headers(options.headers);
  if(!['GET','HEAD','OPTIONS'].includes(method)&&!headers.has('Idempotency-Key'))headers.set('Idempotency-Key',randomUUID());
  return fetch(new URL(route,origin),{...options,method,headers});
}

async function main(){
  const identity=await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(identity[0].name,databaseName,'Prisma must connect to the guarded temporary database');
  const email=(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const password=process.env.ADMIN_PASSWORD||'';
  assert.ok(email&&password,'ADMIN_EMAIL and ADMIN_PASSWORD are required');
  const login=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(login.status,200,'login must succeed');
  const cookie=login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie,'session cookie required');
  const session=await request('/api/session',{headers:{cookie}});assert.equal(session.status,200,'fresh session required');
  const actor=await session.json();assert.ok(actor.userId&&actor.source==='database','a database-backed session is required');
  const headers={cookie,'X-Operation-User':actor.userId};
  for(const page of ['/','/stores','/map','/refills','/inventory','/production','/expenses','/reports','/operations','/audit-log']){
    const r=await request(page,{headers,redirect:'manual'}); assert.equal(r.status,200,`${page} should be 200`);
  }

  // A unique clone fixture proves the HTTP server uses the same clone before
  // sending a business mutation. No existing business material/product is edited.
  const tag=randomUUID();
  const m=await prisma.rawMaterial.create({data:{code:`SMOKE-M-${tag.slice(0,8)}`,name:`Smoke material ${tag}`,category:'ingredient',unit:'kg',currentStock:10,minStockAlert:1,avgCostPerUnit:'1.2500'}});materialId=m.id;
  const inventory=await request(`/inventory?cloneProbe=${tag}`,{headers});assert.equal(inventory.status,200);
  assert.ok((await inventory.text()).includes(m.name),'test server must render the guarded clone fixture before any PATCH');
  const patch=await request(`/api/materials/${m.id}`,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({code:m.code,name:m.name,category:m.category,unit:m.unit,minStock:Number(m.minStockAlert),avgCostPerUnit:Number(m.avgCostPerUnit),isActive:m.isActive})});
  assert.equal(patch.status,200,'material save should succeed');
  const inv=await request('/inventory?e2e=1',{headers}); const html=await inv.text(); assert.equal(inv.status,200); assert.ok(html.includes(m.name),'inventory should render saved material');

  const p=await prisma.finishedProduct.create({data:{code:`SMOKE-P-${tag.slice(0,8)}`,name:`Smoke product ${tag}`,retailPrice:'1000.25',shelfLifeDays:7}});productId=p.id;
  const explicitKey=randomUUID();
  const productBody=JSON.stringify({code:p.code,name:p.name,sizeDescription:p.sizeDescription,retailPrice:Number(p.retailPrice),shelfLifeDays:p.shelfLifeDays,isActive:p.isActive});
  const productOptions={method:'PATCH',headers:{...headers,'content-type':'application/json','idempotency-key':explicitKey},body:productBody};
  const productPatch=await request(`/api/products/${p.id}`,productOptions);
  assert.equal(productPatch.status,200,'product save should succeed');
  const firstResult=await productPatch.json();
  const replay=await request(`/api/products/${p.id}`,productOptions);assert.equal(replay.status,200,'explicit-key product replay should succeed');
  assert.deepEqual(await replay.json(),firstResult,'an explicit operation key must be preserved');
  assert.equal(await prisma.auditLog.count({where:{entityType:'finished_product',entityId:p.id,action:'update'}}),1,'same-key replay must not duplicate the product audit');
  const badRefill=await request('/api/refills',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({storeId:'',items:[]})});
  assert.equal(badRefill.status,400,'invalid refill should be rejected safely');
  const ops=await request('/operations?e2e=1',{headers}); const opsHtml=await ops.text(); assert.equal(ops.status,200); assert.ok(opsHtml.includes('ສິນຄ້າ')&&opsHtml.includes('ສູດ')&&!opsHtml.includes('ຜູ້ໃຊ້'),'operations should render product and recipe management without user management');
  console.log('Authenticated E2E smoke passed on guarded clone');
}
main().finally(async()=>{
  try {
    if(productId)await prisma.finishedProduct.deleteMany({where:{id:productId}});
    if(materialId)await prisma.rawMaterial.deleteMany({where:{id:materialId}});
  } finally {await prisma.$disconnect();}
});
