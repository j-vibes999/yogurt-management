import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const apply=process.argv.includes("--apply");
const root=process.cwd(),source=path.join(root,"public","uploads","receipts"),target=path.join(root,".yogurt","private-receipts");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const names=await fs.readdir(source).catch(error=>{if(error.code==="ENOENT")return [];throw error;});
let moved=0;
if(apply)await fs.mkdir(target,{recursive:true,mode:0o700});
for(const name of names){
  if(!/^receipt-[A-Za-z0-9-]+\.(?:jpg|jpeg|png|webp|pdf)$/.test(name))throw new Error("Unexpected receipt filename; migration stopped before moving it");
  const from=path.join(source,name),to=path.join(target,name);const info=await fs.lstat(from);
  if(!info.isFile()||info.isSymbolicLink())throw new Error("Unsupported receipt entry");
  const bytes=await fs.readFile(from);
  if(apply){
    try{await fs.writeFile(to,bytes,{flag:"wx",mode:0o600});}
    catch(error){if(error.code!=="EEXIST")throw error;const existing=await fs.lstat(to);if(!existing.isFile()||existing.isSymbolicLink()||hash(await fs.readFile(to))!==hash(bytes))throw new Error("Receipt destination conflict");}
    if(hash(await fs.readFile(to))!==hash(bytes))throw new Error("Receipt copy verification failed");
    await fs.chmod(to,0o600);await fs.unlink(from);moved++;
  }
}
console.log(JSON.stringify({mode:apply?"applied":"dry-run",receipts:names.length,moved}));
