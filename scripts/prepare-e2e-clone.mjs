import { randomBytes, scryptSync } from 'node:crypto';
import { assertLocalScratchDatabase } from '../src/lib/backup-readiness.ts';

// Guard before constructing a client or running any SQL. Never import the general/demo seed.
const target=assertLocalScratchDatabase(process.env.DATABASE_URL||'');
if(!target.pathname.startsWith('/yogurt_e2e_'))throw new Error('E2E fixtures require a local yogurt_e2e_ database');
const email=process.env.ADMIN_EMAIL||'', password=process.env.ADMIN_PASSWORD||'';
if(!/^e2e-[a-f0-9-]+@example\.test$/.test(email)||password.length<32)throw new Error('A fresh synthetic E2E administrator is required');
const mode=process.env.E2E_FIXTURE_MODE||'minimal';
if(!['minimal','existing'].includes(mode))throw new Error('Unknown E2E fixture mode');
const { PrismaClient }=await import('@prisma/client');
const prisma=new PrismaClient();
try {
  const salt=randomBytes(16),hash=scryptSync(password,salt,64);
  await prisma.user.create({data:{email,fullName:'E2E Clone Admin',role:'admin',passwordHash:`scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`}});
  if(mode==='minimal')await prisma.$transaction(async tx=>{
    const productId='e2e-readiness-product',storeId='e2e-readiness-store',fridgeId='e2e-readiness-fridge',materialId='e2e-readiness-material';
    await tx.rawMaterial.create({data:{id:materialId,code:'E2E-READINESS-MATERIAL',name:'E2E clone material',category:'ingredient',unit:'kg',currentStock:100,minStockAlert:1,avgCostPerUnit:1000}});
    await tx.finishedProduct.create({data:{id:productId,code:'E2E-READINESS-PRODUCT',name:'E2E clone yogurt',retailPrice:20000,shelfLifeDays:21,isActive:true}});
    await tx.recipe.create({data:{id:'e2e-readiness-recipe',finishedProductId:productId,name:'E2E clone recipe',version:1,baseCups:10,isDefault:true,items:{create:[{rawMaterialId:materialId,quantityRequired:1}]}}});
    await tx.store.create({data:{id:storeId,name:'E2E clone store',commissionRate:'0.30',isActive:true}});
    await tx.fridge.create({data:{id:fridgeId,assetCode:'E2E-READINESS-FRIDGE',currentStoreId:storeId,status:'active',capacityCups:100}});
    await tx.fridgeInventory.create({data:{storeId,fridgeId,finishedProductId:productId,currentStock:10}});
  });
  console.log(`Prepared ${mode} fixtures in a local disposable clone; original restore verification remains separate.`);
} finally { await prisma.$disconnect(); }
