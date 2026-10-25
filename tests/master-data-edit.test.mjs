import assert from "node:assert/strict";
import test from "node:test";
import { materialEditPatch, productEditPatch } from "../src/lib/master-data-edit.ts";

const material={code:"MILK",name:"Milk",category:"ingredient",unit:"L",minStock:5,cost:10.9091};
const materialValues={code:"MILK",name:"Milk",category:"ingredient",unit:"L",minStock:"5.000",avgCostPerUnit:"10.909100"};
const product={code:"YG",name:"Yogurt",sizeDescription:"74 ml",retailPrice:10000,shelfLifeDays:21};
const productValues={code:"YG",name:"Yogurt",sizeDescription:"74 ml",retailPrice:"10000.00",shelfLifeDays:"21"};

test("a material name edit preserves the newer cost written by a concurrent receipt",()=>{
  const patch=materialEditPatch(material,{...materialValues,name:"Milk updated"});
  assert.deepEqual(patch,{name:"Milk updated"});
  const current={...material,name:"Milk",avgCostPerUnit:11.6667};
  assert.equal({...current,...patch}.avgCostPerUnit,11.6667);
});

test("product metadata edits preserve a newer price and shelf life",()=>{
  const patch=productEditPatch(product,{...productValues,sizeDescription:"100 ml"});
  assert.deepEqual(patch,{sizeDescription:"100 ml"});
  const current={...product,retailPrice:11000,shelfLifeDays:28};
  assert.deepEqual({...current,...patch},{...current,sizeDescription:"100 ml"});
});

test("equivalent numeric formatting and surrounding text whitespace are no changes",()=>{
  assert.deepEqual(materialEditPatch(material,{...materialValues,name:" Milk ",avgCostPerUnit:"010.9091000",minStock:"5e0"}),{});
  assert.deepEqual(productEditPatch(product,{...productValues,retailPrice:"1e4",shelfLifeDays:"21.00"}),{});
  assert.deepEqual(productEditPatch({...product,sizeDescription:null},{...productValues,sizeDescription:""}),{});
  assert.deepEqual(materialEditPatch({...material,cost:0},{...materialValues,avgCostPerUnit:"0.0000"}),{});
});

test("intentional numeric edits and nullable description clearing are retained",()=>{
  assert.deepEqual(materialEditPatch(material,{...materialValues,minStock:"0",avgCostPerUnit:"12.1234"}),{minStock:"0",avgCostPerUnit:"12.1234"});
  assert.deepEqual(productEditPatch(product,{...productValues,sizeDescription:"",retailPrice:"0.00",shelfLifeDays:"14"}),{sizeDescription:null,retailPrice:"0.00",shelfLifeDays:"14"});
});

test("fine or invalid numeric changes stay in the patch for API validation",()=>{
  assert.deepEqual(productEditPatch(product,{...productValues,retailPrice:"10000.000000000000000001"}),{retailPrice:"10000.000000000000000001"});
  assert.deepEqual(materialEditPatch({...material,cost:0},{...materialValues,avgCostPerUnit:""}),{avgCostPerUnit:""});
  assert.deepEqual(materialEditPatch(material,{name:"Milk",stock:"999",unexpected:"value"}),{});
});
