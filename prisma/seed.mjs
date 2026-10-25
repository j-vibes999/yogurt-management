import { PrismaClient } from "@prisma/client";
const client=new PrismaClient();
const stores=[
["store-01","Mekong Garden","ທ່ານ ນ້ອຍ","020 5555 1001","Mekong Garden","ຖະໜົນຟ້າງຸ່ມ, ວຽງຈັນ","2026-07-01",17.9628,102.6048],
["store-02","Sabaidee Cafe","ທ່ານ ມາຍ","020 5555 1002","Sabaidee Cafe","ຖະໜົນເສດຖາທິລາດ, ວຽງຈັນ","2026-07-08",17.9662,102.6141],
["store-03","Vientiane Kitchen","ທ່ານ ລີ","020 5555 1003","Vientiane Kitchen","ຖະໜົນສາມແສນໄທ, ວຽງຈັນ","2026-07-15",17.9666,102.6088],
["store-04","Green Bowl","ທ່ານ ແອນ","020 5555 1004","Green Bowl VTE","ທາດຫຼວງ, ວຽງຈັນ","2026-07-22",17.9758,102.6331],
["store-05","Daily Corner","ທ່ານ ບຸນ","020 5555 1005","Daily Corner","ສີສັດຕະນາກ, ວຽງຈັນ","2026-08-01",17.9487,102.6205],
["store-06","Home Taste","ທ່ານ ປຸ້ຍ","020 5555 1006","Home Taste Laos","ໂພນສະຫວັນ, ວຽງຈັນ","2026-08-06",17.9875,102.6217],
["store-07","Fresh Day","ທ່ານ ດາ","020 5555 1007","Fresh Day Vientiane","ດົງປ່າລານ, ວຽງຈັນ","2026-08-12",17.9519,102.6094],
["store-08","Baan Cafe","ທ່ານ ຕິກ","020 5555 1008","Baan Cafe","ໂພນຕ້ອງ, ວຽງຈັນ","2026-08-18",17.9818,102.6432],
["store-09","River View Eatery","ທ່ານ ແກ້ວ","020 5555 1009","River View Eatery","ແຄມຂອງ, ວຽງຈັນ","2026-08-25",17.9597,102.5972],
["store-10","Happy Meal","ທ່ານ ພອນ","020 5555 1010","Happy Meal Laos","ໄຊເສດຖາ, ວຽງຈັນ","2026-09-01",17.9776,102.6493],
];
const stocks=[[18,12],[8,6],[27,24],[15,20],[5,9],[32,31],[11,7],[0,0],[21,19],[13,17]];
const materials=[
["rm-cream","RM-CREAM","ວິບຄຣີມ","ingredient","L",18,8],
["rm-condensed","RM-CONDENSED","ນົມຂົ້ນຫວານ","ingredient","kg",9.4,4],
["rm-milkpowder","RM-MILKPOWDER","ນົມຜົງ","ingredient","kg",12.5,5],
["rm-sugar","RM-SUGAR","ນ້ຳຕານ","ingredient","kg",16.8,6],
["rm-cheese","RM-CHEESE","ຜົງລົດນົມຊີສ","ingredient","kg",1.25,.5],
["rm-mango","RM-MANGO","ຜົງລົດໝາກມ່ວງ","ingredient","kg",.82,.5],
["rm-probiotic","RM-PROBIOTIC","ຜົງຈຸລິນຊີ No.1","ingredient","ຊອງ",76,40],
["rm-water","RM-WATER","ນ້ຳສະອາດ","ingredient","L",50,10],
["rm-cupset","PK-CUPSET","ຊຸດຖ້ວຍ + ຝາ + ບ່ວງ","packaging","ຊຸດ",1280,500],
];
const settlements=[
["ST-2026-000121","store-01",38,42,1600000,480000,1120000,1120000,"bank","paid"],
["ST-2026-000122","store-03",31,26,1140000,342000,798000,600000,"cash","partial"],
["ST-2026-000123","store-06",22,25,940000,282000,658000,658000,"cash","paid"],
["ST-2026-000124","store-09",29,33,1240000,372000,868000,0,"bank","pending"],
];
async function main(prisma){
await prisma.user.upsert({
  where:{email:"admin@yogurt.local"},
  update:{fullName:"Yogurt Local Admin",role:"admin"},
  create:{id:"user-admin-local",email:"admin@yogurt.local",passwordHash:"!LOCAL-SYSTEM-ACCOUNT-NO-PASSWORD-LOGIN!",role:"admin",fullName:"Yogurt Local Admin"},
});
await prisma.user.upsert({where:{email:"owner@yogurt.local"},update:{fullName:"Owner",role:"admin"},create:{id:"user-owner",email:"owner@yogurt.local",passwordHash:"__LOCAL_SETUP_NO_LOGIN__",role:"admin",fullName:"Owner"}});
await prisma.finishedProduct.upsert({where:{id:"p-cheese"},update:{code:"YG-CHS-74",name:"ໂຢເກີດລົດນົມຊີສ",sizeDescription:"74 ml",retailPrice:20000,shelfLifeDays:21,isActive:true},create:{id:"p-cheese",code:"YG-CHS-74",name:"ໂຢເກີດລົດນົມຊີສ",sizeDescription:"74 ml",retailPrice:20000,shelfLifeDays:21,isActive:true}});
await prisma.finishedProduct.upsert({where:{id:"p-mango"},update:{code:"YG-MNG-74",name:"ໂຢເກີດລົດໝາກມ່ວງ",sizeDescription:"74 ml",retailPrice:20000,shelfLifeDays:21,isActive:true},create:{id:"p-mango",code:"YG-MNG-74",name:"ໂຢເກີດລົດໝາກມ່ວງ",sizeDescription:"74 ml",retailPrice:20000,shelfLifeDays:21,isActive:true}});
for(let i=0;i<stores.length;i++){const [id,name,contactName,phone,facebook,address,start,lat,lng]=stores[i];await prisma.store.upsert({where:{id},update:{name,contactName,phone,whatsapp:phone,facebook,address,fridgeStartDate:new Date(start),latitude:lat,longitude:lng,commissionRate:.3,monthlyElectricity:200000,isActive:true},create:{id,name,contactName,phone,whatsapp:phone,facebook,address,fridgeStartDate:new Date(start),latitude:lat,longitude:lng,commissionRate:.3,monthlyElectricity:200000,isActive:true}});const fi=String(i+1).padStart(2,"0"),asset=String(i+1).padStart(3,"0"),serial=String(i+1).padStart(4,"0");await prisma.fridge.upsert({where:{id:"fridge-"+fi},update:{assetCode:"FR-"+asset,model:"Yogurt Display 100",serialNo:"YD100-"+serial,capacityCups:100,currentStoreId:id,status:i===7?"maintenance":"active"},create:{id:"fridge-"+fi,assetCode:"FR-"+asset,model:"Yogurt Display 100",serialNo:"YD100-"+serial,capacityCups:100,currentStoreId:id,status:i===7?"maintenance":"active"}});for(const [productId,qty] of [["p-cheese",stocks[i][0]],["p-mango",stocks[i][1]]])await prisma.fridgeInventory.upsert({where:{fridgeId_finishedProductId:{fridgeId:"fridge-"+fi,finishedProductId:productId}},update:{storeId:id,currentStock:qty,lastAuditDate:new Date("2026-09-13")},create:{storeId:id,fridgeId:"fridge-"+fi,finishedProductId:productId,currentStock:qty,lastAuditDate:new Date("2026-09-13")}});}
for(const [id,code,name,category,unit,stock,minStock] of materials)await prisma.rawMaterial.upsert({where:{id},update:{code,name,category,unit,currentStock:stock,minStockAlert:minStock,avgCostPerUnit:0},create:{id,code,name,category,unit,currentStock:stock,minStockAlert:minStock,avgCostPerUnit:0}});
const cheeseRecipe=await prisma.recipe.upsert({
  where:{finishedProductId_version:{finishedProductId:"p-cheese",version:1}},
  update:{name:"ສູດນົມຊີສ v1",baseCups:100,isDefault:true,items:{deleteMany:{},create:[
    {rawMaterialId:"rm-cream",quantityRequired:2},
    {rawMaterialId:"rm-condensed",quantityRequired:.56},
    {rawMaterialId:"rm-milkpowder",quantityRequired:.56},
    {rawMaterialId:"rm-cheese",quantityRequired:.09},
    {rawMaterialId:"rm-sugar",quantityRequired:.472},
    {rawMaterialId:"rm-water",quantityRequired:4.8},
    {rawMaterialId:"rm-probiotic",quantityRequired:10},
    {rawMaterialId:"rm-cupset",quantityRequired:100},
  ]}},
  create:{id:"recipe-cheese-v1",finishedProductId:"p-cheese",name:"ສູດນົມຊີສ v1",version:1,baseCups:100,isDefault:true,items:{create:[
    {rawMaterialId:"rm-cream",quantityRequired:2},
    {rawMaterialId:"rm-condensed",quantityRequired:.56},
    {rawMaterialId:"rm-milkpowder",quantityRequired:.56},
    {rawMaterialId:"rm-cheese",quantityRequired:.09},
    {rawMaterialId:"rm-sugar",quantityRequired:.472},
    {rawMaterialId:"rm-water",quantityRequired:4.8},
    {rawMaterialId:"rm-probiotic",quantityRequired:10},
    {rawMaterialId:"rm-cupset",quantityRequired:100},
  ]}},
});
const mangoRecipe=await prisma.recipe.upsert({
  where:{finishedProductId_version:{finishedProductId:"p-mango",version:1}},
  update:{name:"ສູດໝາກມ່ວງ v1",baseCups:50,isDefault:true,items:{deleteMany:{},create:[
    {rawMaterialId:"rm-cream",quantityRequired:1},
    {rawMaterialId:"rm-condensed",quantityRequired:.28},
    {rawMaterialId:"rm-mango",quantityRequired:.05},
    {rawMaterialId:"rm-sugar",quantityRequired:.22},
    {rawMaterialId:"rm-milkpowder",quantityRequired:.3},
    {rawMaterialId:"rm-water",quantityRequired:2.5},
    {rawMaterialId:"rm-probiotic",quantityRequired:5},
    {rawMaterialId:"rm-cupset",quantityRequired:50},
  ]}},
  create:{id:"recipe-mango-v1",finishedProductId:"p-mango",name:"ສູດໝາກມ່ວງ v1",version:1,baseCups:50,isDefault:true,items:{create:[
    {rawMaterialId:"rm-cream",quantityRequired:1},
    {rawMaterialId:"rm-condensed",quantityRequired:.28},
    {rawMaterialId:"rm-mango",quantityRequired:.05},
    {rawMaterialId:"rm-sugar",quantityRequired:.22},
    {rawMaterialId:"rm-milkpowder",quantityRequired:.3},
    {rawMaterialId:"rm-water",quantityRequired:2.5},
    {rawMaterialId:"rm-probiotic",quantityRequired:5},
    {rawMaterialId:"rm-cupset",quantityRequired:50},
  ]}},
});
await prisma.productionBatch.upsert({where:{batchNumber:"CHS-20260915-001"},update:{recipeId:cheeseRecipe.id,finishedProductId:"p-cheese",quantityProduced:300,quantityRemaining:220,mfgDate:new Date("2026-09-15T00:00:00Z"),expDate:new Date("2026-10-06T00:00:00Z"),status:"completed"},create:{batchNumber:"CHS-20260915-001",recipeId:cheeseRecipe.id,finishedProductId:"p-cheese",quantityProduced:300,quantityRemaining:220,mfgDate:new Date("2026-09-15T00:00:00Z"),expDate:new Date("2026-10-06T00:00:00Z"),status:"completed"}});
await prisma.productionBatch.upsert({where:{batchNumber:"MNG-20260915-001"},update:{recipeId:mangoRecipe.id,finishedProductId:"p-mango",quantityProduced:250,quantityRemaining:190,mfgDate:new Date("2026-09-15T00:00:00Z"),expDate:new Date("2026-10-06T00:00:00Z"),status:"completed"},create:{batchNumber:"MNG-20260915-001",recipeId:mangoRecipe.id,finishedProductId:"p-mango",quantityProduced:250,quantityRemaining:190,mfgDate:new Date("2026-09-15T00:00:00Z"),expDate:new Date("2026-10-06T00:00:00Z"),status:"completed"}});
const requests=[["RF-260920-01","store-02","waiting",42,44,"ຮ້ານໂທແຈ້ງວ່າສິນຄ້າໃກ້ໝົດ"],["RF-260920-02","store-05","waiting",45,41,null],["RF-260920-03","store-07","delivering",39,43,null]];for(const [id,storeId,status,cheese,mango,note] of requests){await prisma.refillRequest.upsert({where:{id},update:{storeId,status,note,requestedAt:new Date("2026-09-20T02:00:00Z"),items:{deleteMany:{},create:[{finishedProductId:"p-cheese",quantity:cheese},{finishedProductId:"p-mango",quantity:mango}]}},create:{id,storeId,status,note,requestedAt:new Date("2026-09-20T02:00:00Z"),items:{create:[{finishedProductId:"p-cheese",quantity:cheese},{finishedProductId:"p-mango",quantity:mango}]}}});}
for(const [receipt,storeId,cheese,mango,gross,commission,net,paid,method,status] of settlements){const si=Number(storeId.slice(-2))-1;const fridgeId="fridge-"+String(si+1).padStart(2,"0");const visitId="visit-"+receipt;await prisma.restockVisit.upsert({where:{id:visitId},update:{storeId,fridgeId,visitDate:new Date("2026-09-20T05:00:00Z"),status:"completed",items:{deleteMany:{},create:[{finishedProductId:"p-cheese",previousStock:stocks[si][0]+cheese,countRemaining:stocks[si][0],countExpiredReturned:0,countRefilled:0,unitsSold:cheese,retailPrice:20000,subtotalGross:cheese*20000},{finishedProductId:"p-mango",previousStock:stocks[si][1]+mango,countRemaining:stocks[si][1],countExpiredReturned:0,countRefilled:0,unitsSold:mango,retailPrice:20000,subtotalGross:mango*20000}]}},create:{id:visitId,storeId,fridgeId,visitDate:new Date("2026-09-20T05:00:00Z"),status:"completed",items:{create:[{finishedProductId:"p-cheese",previousStock:stocks[si][0]+cheese,countRemaining:stocks[si][0],countExpiredReturned:0,countRefilled:0,unitsSold:cheese,retailPrice:20000,subtotalGross:cheese*20000},{finishedProductId:"p-mango",previousStock:stocks[si][1]+mango,countRemaining:stocks[si][1],countExpiredReturned:0,countRefilled:0,unitsSold:mango,retailPrice:20000,subtotalGross:mango*20000}]}}});await prisma.settlement.upsert({where:{restockVisitId:visitId},update:{storeId,grossAmount:gross,storeCommissionAmount:commission,netPayableAmount:net,paymentStatus:status,paymentMethod:method,paidAmount:paid,closingBalance:Math.max(0,net-paid),receiptNumber:receipt,settlementDate:new Date("2026-09-20T05:30:00Z")},create:{restockVisitId:visitId,storeId,grossAmount:gross,storeCommissionAmount:commission,netPayableAmount:net,paymentStatus:status,paymentMethod:method,paidAmount:paid,closingBalance:Math.max(0,net-paid),receiptNumber:receipt,settlementDate:new Date("2026-09-20T05:30:00Z")}});}
const expenseSeeds=[
  ["expense-2026-09-electricity","electricity",2000000,"2026-09-01T00:00:00Z","ຄ່າໄຟຕູ້ແຊ່ 10 ຮ້ານ · 200,000 LAK/ຮ້ານ"],
  ["expense-2026-09-fuel","fuel",780000,"2026-09-10T00:00:00Z","ຄ່ານ້ຳມັນ / ຂົນສົ່ງ"],
  ["expense-2026-09-other","other",320000,"2026-09-15T00:00:00Z","ຄ່າໃຊ້ຈ່າຍອື່ນໆ"],
];
for(const [id,category,amount,incurredAt,note] of expenseSeeds){
  await prisma.expense.upsert({
    where:{id},
    update:{category,amount,incurredAt:new Date(incurredAt),note,storeId:null},
    create:{id,category,amount,incurredAt:new Date(incurredAt),note,storeId:null},
  });
}
console.log("Seeded yogurt database: local admin, 2 products, 10 stores/fridges, inventory, refills, settlements, raw materials and expenses.");}
await client.$transaction(async (tx)=>main(tx),{maxWait:10000,timeout:120000}).finally(()=>client.$disconnect());
