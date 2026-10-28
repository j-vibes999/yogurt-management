import test from 'node:test';
import assert from 'node:assert/strict';
const readiness = await import('../src/lib/backup-readiness.ts').catch(()=>({}));
const now=Date.parse('2026-10-28T12:00:00Z');
const source='postgresql://postgres.project:secret@pool.example:5432/postgres?schema=public&sslmode=require';
test('backup identity excludes rotated credentials and transport options, but distinguishes source databases',()=>{
  assert.equal(typeof readiness.databaseFingerprint,'function','target fingerprint helper is required');
  const fingerprint=readiness.databaseFingerprint(source);
  assert.match(fingerprint,/^sha256:[a-f0-9]{64}$/);
  assert.equal(fingerprint,readiness.databaseFingerprint(source.replace(':secret@',':changed@').replace('&sslmode=require','&sslmode=verify-full')));
  for(const changed of [source.replace('postgres.project','postgres.other'),source.replace('/postgres?','/other?'),source.replace('schema=public','schema=other')])assert.notEqual(fingerprint,readiness.databaseFingerprint(changed));
});
test('readiness requires the active target, fresh success, no later failure and an exact successful restore',()=>{
  assert.equal(typeof readiness.evaluateBackupReadiness,'function','readiness evaluator is required');
  const backup={ok:true,scope:'public',file:'good.dump',sha256:'a'.repeat(64),createdAt:'2026-10-28T11:00:00Z',sourceFingerprint:readiness.databaseFingerprint(source)};
  const attempt={...backup,attemptedAt:'2026-10-28T11:00:00Z'};
  const restore={...backup,verifiedAt:'2026-10-28T11:30:00Z'};
  const evaluate=(b=backup,a=attempt,r=restore)=>readiness.evaluateBackupReadiness(source,b,a,r,now);
  assert.equal(evaluate().ok,true);
  for(const [b,a,r,reason] of [
    [{...backup,sourceFingerprint:'old-local'},attempt,restore,'wrong-target'],
    [{...backup,createdAt:'2026-10-26T11:00:00Z'},attempt,restore,'stale'],
    [backup,{...attempt,ok:false,attemptedAt:'2026-10-28T11:15:00Z'},restore,'latest-attempt-failed'],
    [backup,attempt,null,'restore-unverified'],
    [backup,attempt,{...restore,sha256:'b'.repeat(64)},'restore-unverified'],
    [backup,attempt,{...restore,ok:false},'restore-unverified'],
    [{...backup,createdAt:'2026-10-29T11:00:00Z'},attempt,restore,'invalid-timestamp'],
  ]) { const result=evaluate(b,a,r); assert.equal(result.ok,false); assert.ok(result.reasons.includes(reason),reason); }
});

test('filesystem readiness treats missing or malformed operation state as unverified',async t=>{
  assert.equal(typeof readiness.loadBackupReadiness,'function','filesystem readiness loader is required');
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yogurt-health-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'.yogurt/backups'); await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'latest.json'),'{broken');
  const result=await readiness.loadBackupReadiness(root,source,now);
  assert.equal(result.ok,false); assert.ok(result.reasons.includes('missing-backup')); assert.equal(result.restoreVerified,false);
});

test('clone fixture writer refuses production and remote targets before connecting',()=>{
  const {spawnSync}=process.getBuiltinModule('node:child_process');
  for(const DATABASE_URL of ['postgresql://test:unused@127.0.0.1:1/production','postgresql://test:unused@source.example/yogurt_e2e_fixture']) {
    const r=spawnSync(process.execPath,['scripts/prepare-e2e-clone.mjs'],{encoding:'utf8',env:{...process.env,DATABASE_URL}});
    assert.notEqual(r.status,0); assert.match(r.stderr,/Refusing writes outside a local yogurt scratch database/); assert.doesNotMatch(r.stderr,/Can.t reach database|PrismaClientInitialization/);
  }
});

test('filesystem readiness requires the verified dump and expected receipt archive to remain present',async t=>{
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yogurt-artifacts-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'.yogurt/backups'); await fs.mkdir(directory,{recursive:true});
  const backup={ok:true,scope:'public',file:'good.dump',sha256:'a'.repeat(64),bytes:4,createdAt:'2026-10-28T11:00:00Z',sourceFingerprint:readiness.databaseFingerprint(source),receipts:'good.receipts.tar.gz'};
  const attempt={...backup,attemptedAt:'2026-10-28T11:00:00Z'};
  const restore={...backup,verifiedAt:'2026-10-28T11:30:00Z'};
  for(const [name,value] of [['latest.json',backup],['latest-attempt.json',attempt],['last-restore-verification.json',restore]])await fs.writeFile(path.join(directory,name),JSON.stringify(value));
  assert.equal((await readiness.loadBackupReadiness(root,source,now)).ok,false,'missing dump cannot be ready');
  await fs.writeFile(path.join(directory,'good.dump'),'dump');
  assert.equal((await readiness.loadBackupReadiness(root,source,now)).ok,false,'missing expected receipt archive cannot be ready');
  await fs.writeFile(path.join(directory,'good.receipts.tar.gz'),'receipt archive');
  assert.equal((await readiness.loadBackupReadiness(root,source,now)).ok,true);
  await fs.writeFile(path.join(directory,'good.dump'),'truncated');
  assert.equal((await readiness.loadBackupReadiness(root,source,now)).ok,false,'size drift invalidates the previous verification');
  await fs.writeFile(path.join(directory,'good.dump'),'dump');
  await fs.writeFile(path.join(directory,'latest.json'),JSON.stringify({...backup,file:'../outside.dump'}));
  assert.equal((await readiness.loadBackupReadiness(root,source,now)).ok,false,'metadata cannot point outside the backup directory');
});

test('identity and clone guard reject libpq target overrides instead of certifying a displayed localhost',()=>{
  assert.equal(typeof readiness.assertLocalScratchDatabase,'function');
  for(const query of ['host=remote.example','hostaddr=203.0.113.1','port=6543','dbname=production','user=other','service=production','servicefile=custom']) {
    assert.throws(()=>readiness.databaseFingerprint(`${source}&${query}`));
    assert.throws(()=>readiness.assertLocalScratchDatabase(`postgresql://test@localhost/yogurt_e2e_fixture?${query}`));
  }
});
