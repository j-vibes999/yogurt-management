import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadBackupReadiness } from '../src/lib/backup-readiness.ts';

// Replace only external commands: scripts, metadata writes, checksums and traps run for real.
const harness = `for command in pg_dump pg_restore psql createdb dropdb curl lsof sleep node mktemp; do
  eval "$command() { \\"$TEST_BIN/$command\\" \\"\\$@\\"; }"
done
source "$0" "$@"`;
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'yogurt-operations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp('scripts', path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'src/lib'), { recursive: true });
  for (const file of ['backup-readiness.ts', 'runtime-paths.ts']) if (existsSync(`src/lib/${file}`)) await cp(`src/lib/${file}`, path.join(root, `src/lib/${file}`));
  await mkdir(path.join(root, 'prisma'), { recursive: true });
  await cp('prisma/schema.prisma', path.join(root, 'prisma/schema.prisma'));
  await writeFile(path.join(root, '.env'), 'DATABASE_URL="postgresql://app:fake@source.example:5432/current?schema=public&sslmode=require"\nLOCAL_DATABASE_URL="postgresql://test:fake@127.0.0.1:1/local"\nADMIN_EMAIL="real@example.test"\nADMIN_PASSWORD="never-use-the-real-password"\n');
  await writeFile(path.join(root, 'scripts/send-alert.sh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LOG/alerts"\n', { mode: 0o755 });
  const bin = path.join(root, 'bin'); await mkdir(bin);
  const tool = `#!${process.execPath}
import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process';
const name=path.basename(process.argv[1]), args=process.argv.slice(2), dir=process.env.TEST_LOG;
fs.appendFileSync(path.join(dir,'commands'), JSON.stringify({name,args,database:process.env.DATABASE_URL,email:process.env.ADMIN_EMAIL,runtimeData:process.env.YOGURT_DATA_ROOT})+'\\n');
if(name==='pg_dump') {
 const marker=path.join(dir,'dump-attempts'); const count=Number(fs.existsSync(marker)?fs.readFileSync(marker,'utf8'):0)+1; fs.writeFileSync(marker,String(count));
 if(count<=Number(process.env.TEST_DUMP_FAILURES||0)) process.exit(7);
 const file=args.find(a=>a.startsWith('--file='))?.slice(7)||args[args.indexOf('-f')+1]; fs.writeFileSync(file,'portable dump');
} else if(name==='pg_restore') {
 if(process.env.TEST_RESTORE_FAIL==='1')process.exit(8);
 const file=args.find(a=>a.startsWith('--file='))?.slice(7), list=args.find(a=>a.startsWith('--use-list='))?.slice(11); if(file)fs.writeFileSync(file,(!list||fs.readFileSync(list,'utf8').includes('SCHEMA - public')?'CREATE SCHEMA public;\\n':'')+'SELECT 1;\\n'); else if(args.includes('--list')||args.includes('-l'))console.log('6; 2615 2200 SCHEMA - public postgres\\n42; 1259 12345 TABLE public users postgres');
} else if(name==='psql') {
 if(process.env.TEST_SQL_FAIL==='1')process.exit(9);
 const file=args[args.indexOf('-f')+1];if(args.includes('-f')&&fs.readFileSync(file,'utf8').includes('CREATE SCHEMA public')){console.error('schema public already exists');process.exit(10);}
 const sql=args[args.findIndex(a=>a==='-Atc'||a==='-c')+1]||'';
 if(sql.includes('json_build_object'))console.log('{"users":1,"stores":0,"materials":1,"settlements":0,"auditLogs":0}');
 else if(sql.includes('count(*)'))console.log('0');
} else if(name==='curl')console.log('{"status":"degraded","db":{"ok":true},"availability":{"ok":true},"readiness":{"ok":false}}');
else if(name==='lsof')process.exit(1);
else if(name==='mktemp') {
 fs.mkdirSync(path.join(dir,'temp'),{recursive:true});
 const result=spawnSync('/usr/bin/mktemp',args.map(a=>a.startsWith('/tmp/')?path.join(dir,'temp',path.basename(a)):a),{encoding:'utf8',env:process.env});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
}
else if(name==='node') {
 if(args.some(a=>a.includes('node_modules/next/'))) { if(process.env.YOGURT_DATA_ROOT){fs.mkdirSync(process.env.YOGURT_DATA_ROOT,{recursive:true});fs.writeFileSync(path.join(process.env.YOGURT_DATA_ROOT,'scratch-server-write'),'scratch');} process.on('SIGTERM',()=>process.exit()); setInterval(()=>{},1000); }
 else if(args.some(a=>a.endsWith('tests/business-workflow-e2e.mjs')))process.exit(Number(process.env.TEST_E2E_EXIT||0));
 else if(args.some(a=>a.endsWith('tests/authenticated-smoke.mjs')))process.exit(0);
 else if(args.some(a=>a.endsWith('prepare-e2e-clone.mjs')||a.endsWith('harden-supabase-api.mjs')||a.endsWith('node_modules/prisma/build/index.js')))process.exit(0);
 else { const result=spawnSync(${JSON.stringify(process.execPath)},args,{stdio:'inherit',env:process.env});process.exit(result.status??1); }
}
`;
  await writeFile(path.join(bin, 'tool.mjs'), tool, { mode: 0o755 });
  for (const name of ['pg_dump','pg_restore','psql','createdb','dropdb','curl','lsof','sleep','node','mktemp']) await cp(path.join(bin,'tool.mjs'),path.join(bin,name));
  return {
    root,
    run(script,args=[],env={}) { return spawnSync('bash',['-c',harness,path.join(root,'scripts',script),...args],{encoding:'utf8',timeout:15000,env:{...process.env,TEST_BIN:bin,TEST_LOG:root,DB_RETRY_DELAY_SECONDS:'0',...env}}); },
    async calls(){ return (await readFile(path.join(root,'commands'),'utf8')).trim().split('\n').map(JSON.parse); },
    async metadata(file){ return JSON.parse(await readFile(path.join(root,'.yogurt/backups',file),'utf8')); },
  };
}

test('backup retries network failures, scopes the app schema and records credential-free source metadata', async t => {
  const f=await fixture(t), r=f.run('backup-db.sh',[],{TEST_DUMP_FAILURES:'1'});
  assert.equal(r.status,0,r.stderr);
  const backup=await f.metadata('latest.json'), attempt=await f.metadata('latest-attempt.json');
  assert.equal(attempt.ok,true); assert.equal(backup.scope,'public'); assert.match(backup.sourceFingerprint,/^sha256:[a-f0-9]{64}$/);
  assert.match(backup.sha256,/^[a-f0-9]{64}$/); assert.equal((await f.calls()).filter(x=>x.name==='pg_dump').length,2);
  const args=(await f.calls()).find(x=>x.name==='pg_dump').args;
  assert.ok(args.includes('--schema=public')); assert.ok(args.includes('--exclude-extension=*'));
  assert.ok(args.at(-1).includes('sslmode=require'),'keep PostgreSQL SSL connection options');
  assert.doesNotMatch(JSON.stringify(backup),/fake|source\.example|postgresql:/);
});

test('manual backup and default restore verification use runtime receipts and matching readiness evidence', async t => {
  const f=await fixture(t), runtime=path.join(f.root,'Application Support','Yogurt Manager','runtime');
  const backups=path.join(runtime,'backups'), receipts=path.join(runtime,'private-receipts');
  const legacy=path.join(f.root,'.yogurt'), legacyBackups=path.join(legacy,'backups');
  await mkdir(receipts,{recursive:true});
  await mkdir(path.join(legacy,'private-receipts'),{recursive:true});
  await mkdir(legacyBackups,{recursive:true});
  await writeFile(path.join(receipts,'receipt-desktop-123.png'),'runtime receipt');
  await writeFile(path.join(legacy,'private-receipts','receipt-stale-123.png'),'stale receipt');
  await writeFile(path.join(legacyBackups,'yogurt_ops-stale.dump'),'stale dump');
  const sentinel='{"state":"stale-repository-evidence"}\n';
  await writeFile(path.join(legacyBackups,'latest.json'),sentinel);

  const env={YOGURT_DATA_ROOT:runtime}, r=f.run('backup-db.sh',[],env);
  assert.equal(r.status,0,r.stderr);
  const dump=r.stdout.trim();
  assert.equal(path.dirname(dump),backups,'the manual backup must write beside desktop runtime evidence');
  const backup=JSON.parse(await readFile(path.join(backups,'latest.json'),'utf8'));
  const archive=path.join(backups,backup.receipts);
  const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8'});
  assert.equal(listing.status,0,listing.stderr);
  assert.match(listing.stdout,/private-receipts\/receipt-desktop-123\.png/);
  assert.doesNotMatch(listing.stdout,/stale/);
  const archived=spawnSync('tar',['-xOzf',archive,'private-receipts/receipt-desktop-123.png'],{encoding:'utf8'});
  assert.equal(archived.status,0,archived.stderr); assert.equal(archived.stdout,'runtime receipt');
  assert.equal((await stat(backups)).mode&0o777,0o700);
  for(const file of [dump,archive,path.join(backups,'latest.json')])assert.equal((await stat(file)).mode&0o777,0o600);

  const verified=f.run('verify-backup-restore.sh',[],env);
  assert.equal(verified.status,0,verified.stderr);
  const verification=JSON.parse(await readFile(path.join(backups,'last-restore-verification.json'),'utf8'));
  assert.equal(verification.ok,true); assert.equal(verification.sha256,backup.sha256); assert.equal(verification.receiptFiles,1);
  const previous=process.env.YOGURT_DATA_ROOT;
  try {
    process.env.YOGURT_DATA_ROOT=runtime;
    const ready=await loadBackupReadiness(f.root,'postgresql://app:fake@source.example:5432/current?schema=public&sslmode=require');
    assert.equal(ready.ok,true,JSON.stringify(ready.reasons));
  } finally {
    if(previous===undefined)delete process.env.YOGURT_DATA_ROOT; else process.env.YOGURT_DATA_ROOT=previous;
  }
  assert.equal(await readFile(path.join(legacyBackups,'latest.json'),'utf8'),sentinel);
  assert.deepEqual((await readdir(legacyBackups)).sort(),['latest.json','yogurt_ops-stale.dump']);
});

test('manual backup tools reject relative data roots before database commands or evidence writes', async t => {
  for(const YOGURT_DATA_ROOT of ['relative/runtime','../outside',''])for(const script of ['backup-db.sh','verify-backup-restore.sh']) {
    const f=await fixture(t), r=f.run(script,[],{YOGURT_DATA_ROOT});
    assert.notEqual(r.status,0); assert.match(r.stderr,/YOGURT_DATA_ROOT must be an absolute path/);
    assert.equal(existsSync(path.join(f.root,'commands')),false,'invalid data roots must fail before database tools run');
    assert.equal(existsSync(path.join(f.root,'.yogurt')),false);
  }
});

test('scratch application checks isolate their writable files from configured desktop data', async t => {
  for(const script of ['disaster-recovery-drill.sh','run-business-e2e.sh']) {
    const f=await fixture(t), runtime=path.join(f.root,'Application Support','runtime');
    const env={YOGURT_DATA_ROOT:runtime};
    if(script==='disaster-recovery-drill.sh')assert.equal(f.run('backup-db.sh',[],env).status,0);
    const r=f.run(script,[],env);
    assert.equal(r.status,0,r.stderr);
    const calls=await f.calls();
    const scratch=calls.filter(x=>x.name==='node'&&x.args.some(a=>a.includes('node_modules/next/')||a.endsWith('prepare-e2e-clone.mjs')||a.endsWith('business-workflow-e2e.mjs')));
    assert.equal(scratch.length,3);
    const scratchRoot=scratch[0].runtimeData;
    assert.ok(scratchRoot&&path.isAbsolute(scratchRoot));
    assert.notEqual(scratchRoot,runtime,'scratch checks must never share the desktop writable directory');
    assert.ok(scratch.every(x=>x.runtimeData===scratchRoot),'the fixture, app and test must use one isolated writable directory');
    assert.equal(existsSync(scratchRoot),false,'scratch writable data must be cleaned after the test server stops');
    assert.equal(existsSync(path.join(runtime,'scratch-server-write')),false);
    if(script==='disaster-recovery-drill.sh') {
      const verified=JSON.parse(await readFile(path.join(runtime,'backups','last-dr-drill.json'),'utf8'));
      assert.equal(verified.ok,true);
      assert.match(verified.sourceFingerprint,/^sha256:/);
    }
  }
});

test('scratch runners choose unique temporary paths and preserve earlier files', async t => {
  for(const script of ['disaster-recovery-drill.sh','run-business-e2e.sh']) {
    const f=await fixture(t), temporary=path.join(f.root,'temp');
    await mkdir(temporary);
    const earlier=['yogurt-dr-server-XXXXXX.log','yogurt-e2e-XXXXXX.dump','yogurt-e2e-server-XXXXXX.log'];
    for(const name of earlier)await writeFile(path.join(temporary,name),'earlier file');
    if(script==='disaster-recovery-drill.sh')assert.equal(f.run('backup-db.sh').status,0);
    const r=f.run(script);
    assert.equal(r.status,0,r.stderr);
    for(const name of earlier)assert.equal(await readFile(path.join(temporary,name),'utf8'),'earlier file');
  }
});

test('failed latest backup attempt preserves last success and removes partial output',async t=>{
  const f=await fixture(t); assert.equal(f.run('backup-db.sh').status,0);
  const good=await f.metadata('latest.json');
  const r=f.run('backup-db.sh',[],{TEST_DUMP_FAILURES:'99'}); assert.notEqual(r.status,0);
  assert.deepEqual(await f.metadata('latest.json'),good); assert.equal((await f.metadata('latest-attempt.json')).ok,false);
  const files=await (await import('node:fs/promises')).readdir(path.join(f.root,'.yogurt/backups'));
  assert.ok(files.every(x=>!x.endsWith('.tmp'))); assert.match(await readFile(path.join(f.root,'alerts'),'utf8'),/backup.failed/);
});

test('offsite backup carries target-bound restore metadata alongside the dump',async t=>{
  for (const encrypted of [false,true]) {
    const f=await fixture(t), offsite=path.join(f.root,'offsite');
    const r=f.run('backup-db.sh',[],{BACKUP_OFFSITE_DIR:offsite,...(encrypted?{BACKUP_PASSPHRASE:'synthetic test passphrase only'}:{})});
    assert.equal(r.status,0,r.stderr);
    const backup=await f.metadata('latest.json');
    const metadataFile=path.join(offsite,backup.file+'.metadata.json'+(encrypted?'.enc':''));
    assert.equal(existsSync(metadataFile),true,'an offsite dump needs its source/checksum metadata to prove the restore target');
    assert.equal(existsSync(metadataFile+'.sha256'),true);
    let text;
    if(encrypted) {
      const decrypted=spawnSync('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-pass','env:TEST_BACKUP_PASSPHRASE','-in',metadataFile],{encoding:'utf8',env:{...process.env,TEST_BACKUP_PASSPHRASE:'synthetic test passphrase only'}});
      assert.equal(decrypted.status,0,decrypted.stderr); text=decrypted.stdout;
    } else text=await readFile(metadataFile,'utf8');
    const copied=JSON.parse(text);
    assert.equal(copied.sourceFingerprint,backup.sourceFingerprint);
    assert.equal(copied.sha256,backup.sha256);
    assert.equal(copied.file,backup.file);
  }
});

test('restore failure is nonzero, drops the scratch database and records failed verification',async t=>{
  const f=await fixture(t); assert.equal(f.run('backup-db.sh').status,0);
  const backup=await f.metadata('latest.json'), r=f.run('verify-backup-restore.sh',[path.join(f.root,'.yogurt/backups',backup.file)],{TEST_RESTORE_FAIL:'1'});
  assert.notEqual(r.status,0); assert.equal((await f.metadata('last-restore-verification.json')).ok,false);
  assert.ok((await f.calls()).some(x=>x.name==='psql'&&x.args.some(a=>a.includes('DROP DATABASE'))));
});

test('restore success checks original restored rows and binds verification to backup checksum',async t=>{
  const f=await fixture(t); assert.equal(f.run('backup-db.sh').status,0);
  const backup=await f.metadata('latest.json'), r=f.run('verify-backup-restore.sh',[path.join(f.root,'.yogurt/backups',backup.file)]);
  assert.equal(r.status,0,r.stderr); const verification=await f.metadata('last-restore-verification.json');
  assert.equal(verification.ok,true); assert.match(verification.sha256,/^[a-f0-9]{64}$/); assert.equal(verification.sha256,backup.sha256); assert.equal(verification.sourceFingerprint,backup.sourceFingerprint); assert.equal(verification.counts.stores,0);
});

test('DR defines the scratch URL and propagates E2E failure while cleaning up',async t=>{
  const f=await fixture(t); assert.equal(f.run('backup-db.sh').status,0);
  const backup=await f.metadata('latest.json'), r=f.run('disaster-recovery-drill.sh',[path.join(f.root,'.yogurt/backups',backup.file)],{TEST_E2E_EXIT:'23'});
  assert.equal(r.status,23,r.stderr); assert.doesNotMatch(r.stderr,/unbound variable/);
  assert.ok((await f.calls()).some(x=>x.name==='dropdb'));
  assert.equal((await f.metadata('last-dr-drill.json')).ok,false);
  const scratch=(await f.calls()).find(x=>x.name==='node'&&x.args.some(a=>a.endsWith('business-workflow-e2e.mjs'))).runtimeData;
  assert.ok(scratch); assert.equal(existsSync(scratch),false,'a failed E2E check must remove its temporary writable data');
});

test('business runner clones the active source into local scratch and uses an ephemeral admin',async t=>{
  const f=await fixture(t), r=f.run('run-business-e2e.sh'); assert.equal(r.status,0,r.stderr);
  const calls=await f.calls(), dump=calls.find(x=>x.name==='pg_dump'), create=calls.find(x=>x.name==='createdb'), e2e=calls.find(x=>x.name==='node'&&x.args.some(a=>a.endsWith('business-workflow-e2e.mjs')));
  assert.ok(dump.args.at(-1).includes('source.example')); assert.ok(create.args.some(a=>a.includes('127.0.0.1:1')));
  assert.match(e2e.database,/127\.0\.0\.1:1\/yogurt_e2e_/); assert.notEqual(e2e.email,'real@example.test'); assert.match(e2e.email,/@example\.test$/);
});

test('scratch runners reject remote maintenance URLs before database creation',async t=>{
  const f=await fixture(t), r=f.run('run-business-e2e.sh',[],{LOCAL_DATABASE_URL:'postgresql://app:fake@source.example:5432/live'});
  assert.notEqual(r.status,0); assert.ok(!(await f.calls()).some(x=>x.name==='createdb'));
});

test('corrupted backup is rejected before scratch creation and records failed restore',async t=>{
  const f=await fixture(t); assert.equal(f.run('backup-db.sh').status,0);
  const backup=await f.metadata('latest.json'), file=path.join(f.root,'.yogurt/backups',backup.file);
  await writeFile(file,'corrupt');
  const r=f.run('verify-backup-restore.sh',[file]); assert.notEqual(r.status,0);
  assert.ok(!(await f.calls()).some(x=>x.name==='psql'&&x.args.some(a=>a.includes('CREATE DATABASE'))));
  assert.equal((await f.metadata('last-restore-verification.json')).ok,false);
});

test('daily backup wrapper verifies the returned dump and preserves failure status and final path',async t=>{
  const f=await fixture(t), dump=path.join(f.root,'daily.dump');
  await writeFile(path.join(f.root,'scripts/backup-db.sh'),`#!/bin/sh\nprintf '%s\\n' '${dump}'\n`,{mode:0o755});
  await writeFile(path.join(f.root,'scripts/verify-backup-restore.sh'),'#!/bin/sh\nprintf "%s" "$1" > "$TEST_LOG/verified-dump"\necho "restore checked"\nexit "${TEST_VERIFY_EXIT:-0}"\n',{mode:0o755});
  const success=f.run('backup-and-verify.sh'); assert.equal(success.status,0,success.stderr); assert.equal(success.stdout.trim(),dump); assert.equal(await readFile(path.join(f.root,'verified-dump'),'utf8'),dump);
  const failure=f.run('backup-and-verify.sh',[],{TEST_VERIFY_EXIT:'17'}); assert.equal(failure.status,17); assert.equal(failure.stdout,'');
});

test('scratch guard rejects libpq host/service overrides before any remote-capable database command',async t=>{
  for(const options of [
    {LOCAL_DATABASE_URL:'postgresql://test:fake@localhost:1/local?host=remote.example'},
    {LOCAL_DATABASE_URL:'postgresql://test:fake@localhost:1/local?hostaddr=203.0.113.1'},
    {LOCAL_DATABASE_URL:'postgresql://test:fake@localhost:1/local?service=production'},
    {LOCAL_DATABASE_URL:'postgresql://test:fake@localhost:1/local',PGHOSTADDR:'203.0.113.1'},
  ]) {
    const f=await fixture(t), r=f.run('run-business-e2e.sh',[],options);
    assert.notEqual(r.status,0); assert.ok(!(await f.calls()).some(x=>['pg_dump','createdb','psql','dropdb'].includes(x.name)));
  }
});
