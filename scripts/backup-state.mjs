import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename, mkdir, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { databaseFingerprint } from '../src/lib/backup-readiness.ts';

const [command, directory, backupPath] = process.argv.slice(2);
const read = async file => JSON.parse(await readFile(file,'utf8'));
async function save(file, data) {
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${process.pid}.tmp`;
  await writeFile(temp,JSON.stringify(data)+'\n',{mode:0o600});
  await rename(temp,file);
}
const timestamp=new Date().toISOString();
let sourceFingerprint=null;
try { sourceFingerprint=databaseFingerprint(process.env.BACKUP_SOURCE_URL||''); } catch {}
const identity={sourceFingerprint,scope:'public'};
async function digest(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
if(command==='backup-start'||command==='backup-failure') {
  await save(path.join(directory,'latest-attempt.json'),{...identity,ok:false,attemptedAt:timestamp,state:command==='backup-start'?'running':'failed'});
} else if(command==='backup-success'||command==='backup-artifact') {
  const data={...identity,ok:true,file:path.basename(backupPath),sha256:await digest(backupPath),bytes:(await stat(backupPath)).size,createdAt:timestamp,receipts:process.env.BACKUP_RECEIPTS?path.basename(process.env.BACKUP_RECEIPTS):null,offsite:process.env.BACKUP_OFFSITE==='true'};
  await save(`${backupPath}.metadata.json`,data);
  if(command==='backup-success') {
    await save(path.join(directory,'latest.json'),data);
    await save(path.join(directory,'latest-attempt.json'),{...data,attemptedAt:timestamp,state:'succeeded'});
  }
} else if(command==='restore-start'||command==='restore-failure'||command==='restore-success'||command==='dr-start'||command==='dr-failure'||command==='dr-success'||command==='dr-skipped') {
  let metadata={}; try { metadata=await read(`${backupPath}.metadata.json`); } catch {}
  // Legacy backups may be restored, but cannot prove which source they protect.
  const data={scope:metadata.scope??null,sourceFingerprint:metadata.sourceFingerprint??null,backup:path.basename(backupPath),sha256:await digest(backupPath).catch(()=>null),ok:command.endsWith('-success'),verifiedAt:timestamp,state:command.endsWith('-start')?'running':command.endsWith('-success')?'succeeded':command.endsWith('-skipped')?'skipped':'failed'};
  if(command==='restore-success')Object.assign(data,{counts:JSON.parse(process.env.RESTORE_COUNTS||'{}'),receiptFiles:Number(process.env.RESTORE_RECEIPT_FILES||0),fixtureDataAdded:false});
  if(command==='dr-success'||command==='dr-skipped')Object.assign(data,{fixtureMode:process.env.E2E_FIXTURE_MODE||'minimal',restoreCheckedBeforeFixtures:true});
  await save(path.join(directory,command.startsWith('dr-')?'last-dr-drill.json':'last-restore-verification.json'),data);
} else if(command==='check') {
  const metadata=await read(`${backupPath}.metadata.json`).catch(()=>null);
  if(metadata && (metadata.sha256!==await digest(backupPath)||metadata.scope!=='public'))throw new Error('Backup metadata checksum/scope mismatch');
  if(metadata?.receipts) {
    if(path.basename(metadata.receipts)!==metadata.receipts)throw new Error('Invalid receipt archive metadata');
    await access(path.join(path.dirname(backupPath),metadata.receipts));
  }
} else throw new Error('Unknown backup state command');
