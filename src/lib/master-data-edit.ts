type EditValues = Record<string, unknown>;
type EditPatch = Record<string, string | null>;
type MaterialSnapshot = { code:string;name:string;category:string;unit:string;minStock:number;cost:number };
type ProductSnapshot = { code:string;name:string;sizeDescription:string|null;retailPrice:number;shelfLifeDays:number };

function text(value:unknown) { return String(value??"").trim(); }

/** Compare decimal values exactly without rounding fine input through a JS number. */
function numericIdentity(value:unknown):string|null {
  if(typeof value!=="string"&&typeof value!=="number")return null;
  const raw=text(value);
  if(!raw||!Number.isFinite(Number(raw)))return null;
  const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if(!match)return null;
  const fraction=match[3]??"";
  let coefficient=(match[2]+fraction).replace(/^0+/,"");
  if(!coefficient)return "0";
  let exponent=Number(match[4]??0)-fraction.length;
  while(coefficient.endsWith("0")){coefficient=coefficient.slice(0,-1);exponent++;}
  return `${match[1]==="-"?"-":""}${coefficient}e${exponent}`;
}

function changedFields(snapshot:Record<string,unknown>,values:EditValues,numericFields:readonly string[],nullableFields:readonly string[]=[]):EditPatch {
  const patch:EditPatch={};
  for(const [field,previous] of Object.entries(snapshot)) {
    if(!Object.hasOwn(values,field))continue;
    const next=text(values[field]);
    if(numericFields.includes(field)) {
      const identity=numericIdentity(values[field]);
      if(identity!==null&&identity===numericIdentity(previous))continue;
    } else if(next===text(previous))continue;
    patch[field]=nullableFields.includes(field)&&!next?null:next;
  }
  return patch;
}

/** Omit untouched costs so receipts committed during editing keep their weighted average. */
export function materialEditPatch(snapshot:MaterialSnapshot,values:EditValues):EditPatch {
  return changedFields({code:snapshot.code,name:snapshot.name,category:snapshot.category,unit:snapshot.unit,minStock:snapshot.minStock,avgCostPerUnit:snapshot.cost},values,["minStock","avgCostPerUnit"]);
}

/** Metadata edits must not restore an old price or shelf life from the editor snapshot. */
export function productEditPatch(snapshot:ProductSnapshot,values:EditValues):EditPatch {
  return changedFields({code:snapshot.code,name:snapshot.name,sizeDescription:snapshot.sizeDescription,retailPrice:snapshot.retailPrice,shelfLifeDays:snapshot.shelfLifeDays},values,["retailPrice","shelfLifeDays"],["sizeDescription"]);
}
