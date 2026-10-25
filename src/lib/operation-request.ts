"use client";

export const SHELL_INVALIDATE_EVENT = "yogurt:shell-invalidate";
export function invalidateShell() { window.dispatchEvent(new Event(SHELL_INVALIDATE_EVENT)); }
const memory = new Map<string, string>();
function read(key:string) { try { return window.localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } }
function write(key:string,value:string) { memory.set(key,value);try { window.localStorage.setItem(key,value); } catch { /* Memory retains retries when storage is disabled. */ } }
function remove(key:string) { memory.delete(key);try { window.localStorage.removeItem(key); } catch { /* Storage can be disabled. */ } }
function clearResolvedOperation(storageKey:string,key:string,pendingKey:string|null,body:string) {
  // A late response must not clear another submission that replaced this key.
  if(read(storageKey)===key)remove(storageKey);
  if(!pendingKey)return;
  try {
    const current=JSON.parse(read(pendingKey)??"null") as {key?:unknown;body?:unknown}|null;
    if(current?.key===key&&current.body===body)remove(pendingKey);
  } catch { /* Preserve unrelated or invalid state for explicit recovery. */ }
}
async function fingerprint(text:string) { const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,"0")).join(""); }
async function definite(response:Response, durable=false) { if(response.ok)return true;if(![400,404,409].includes(response.status))return false;const data=await response.clone().json().catch(()=>null);return data?.retryable===false || (durable && data?.retryable!==true); }

/** A fresh identity prevents one browser account replaying another account's command. */
export async function freshOperationUser(): Promise<string> {
  const response=await fetch("/api/session",{cache:"no-store"});
  const session=await response.json().catch(()=>null) as {userId?:string;source?:string}|null;
  if(!response.ok||!session?.userId)throw new Error("ກະລຸນາເຂົ້າລະບົບຄືນກ່ອນເຮັດລາຍການ");
  if(session.source!=="database")throw new Error("ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ. ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ");
  return session.userId;
}

/** Preserve uncertain business submissions and resolve them before a different command. */
export async function operationFetch(url: string, payload: unknown, options: { method?: "POST" | "PATCH" | "DELETE"; key?: string; userId?: string } = {}): Promise<Response> {
  const userId=await freshOperationUser();
  if(options.userId&&options.userId!==userId)throw new Error("ບັນຊີຜູ້ໃຊ້ປ່ຽນແປງ. ກະລຸນາໂຫຼດໜ້າຄືນ ແລະກວດກາລາຍການ");
  if(options.key&&!/^[0-9a-f-]{36}$/i.test(options.key))throw new Error("ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ");
  const method=options.method??"POST",body=JSON.stringify(payload);
  const hash=await fingerprint(`${userId}:${method}:${url}:${body}`),storageKey=`yogurt:operation:${hash}`;
  const pendingKey=`yogurt:pending-operation:${await fingerprint(`${userId}:${method}:${url}`)}`;
  // Exact-body recovery is reserved for APIs that commit a durable operation receipt.
  const durable=(method==="POST"&&/^\/api\/(?:inventory\/(?:receive|adjust)|recipes|production-batches|restock-visits|settlements\/pay|finished-goods\/adjust|daily-closing|refills|materials|products|stores|expenses)$/.test(url))
    || (method==="PATCH"&&/^\/api\/(?:expenses|materials|products)\/[^/]+$/.test(url))
    || (method==="DELETE"&&/^\/api\/expenses\/[^/]+$/.test(url));
  const rememberBody=durable;
  const send=(savedBody:string,key:string)=>fetch(url,{method,headers:{"Content-Type":"application/json","Idempotency-Key":key,"X-Operation-User":userId},body:savedBody});
  if(rememberBody){
    const previousText=read(pendingKey);
    let previous:{body:string;key:string;hash:string}|null=null;
    try{previous=previousText?JSON.parse(previousText):null;}catch{remove(pendingKey);}
    if(previous&&(previous.body!==body||(options.key&&options.key!==previous.key))&&typeof previous.body==="string"&&/^[0-9a-f-]{36}$/i.test(previous.key)){
      const resolved=await send(previous.body,previous.key);
      if(await definite(resolved,durable))clearResolvedOperation(`yogurt:operation:${previous.hash}`,previous.key,pendingKey,previous.body);
      if(resolved.ok){invalidateShell();throw new Error("ລາຍການກ່ອນໜ້າບັນທຶກສຳເລັດແລ້ວ. ກະລຸນາໂຫຼດໜ້າຄືນ ແລະກວດກາກ່ອນເຮັດລາຍການໃໝ່");}
      if([401,403].includes(resolved.status))return resolved;
      if(!(await definite(resolved,durable)))throw new Error("ຍັງຢືນຢັນລາຍການກ່ອນໜ້າບໍ່ໄດ້. ກະລຸນາກວດອິນເຕີເນັດ ແລະລອງອີກຄັ້ງ");
    }
  }
  let key=options.key??read(storageKey);if(!key||!/^[0-9a-f-]{36}$/i.test(key))key=crypto.randomUUID();
  write(storageKey,key);
  if(rememberBody)write(pendingKey,JSON.stringify({body,key,hash}));
  const response=await send(body,key);
  if(await definite(response,durable))clearResolvedOperation(storageKey,key,rememberBody?pendingKey:null,body);
  if(response.ok)invalidateShell();
  return response;
}
