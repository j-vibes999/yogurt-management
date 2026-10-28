import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Replace only external commands: scripts, metadata writes, checksums and traps run for real.
const harness = `for command in pg_dump pg_restore psql createdb dropdb curl lsof sleep node; do
  eval "$command() { \\"$TEST_BIN/$command\\" \\"\\$@\\"; }"
done
source "$0" "$@"`;
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'yogurt-operations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp('scripts', path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'src/lib'), { recursive: true });
  if (existsSync('src/lib/backup-readiness.ts')) await cp('src/lib/backup-readiness.ts', path.join(root, 'src/lib/backup-readiness.ts'));
  await mkdir(path.join(root, 'prisma'), { recursive: true });
  await cp('prisma/schema.prisma', path.join(root, 'prisma/schema.prisma'));
  await writeFile(path.join(root, '.env'), 'DATABASE_URL="postgresql://app:fake@source.example:5432/current?schema=public&sslmode=require"\nLOCAL_DATABASE_URL="postgresql://test:fake@127.0.0.1:1/local"\nADMIN_EMAIL="real@example.test"\nADMIN_PASSWORD="never-use-the-real-password"\n');
  await writeFile(path.join(root, 'scripts/send-alert.sh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LOG/alerts"\n', { mode: 0o755 });
  const bin = path.join(root, 'bin'); await mkdir(bin);
  const tool = `#!${process.execPath}
import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process';
const name=path.basename(process.argv[1]), args=process.argv.slice(2), dir=process.env.TEST_LOG;
fs.appendFileSync(path.join(dir,'commands'), JSON.stringify({name,args,database:process.env.DATABASE_URL,email:process.env.ADMIN_EMAIL})+'\\n');
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
else if(name==='node') {
 if(args.some(a=>a.includes('node_modules/next/'))) { process.on('SIGTERM',()=>process.exit()); setInterval(()=>{},1000); }
 else if(args.some(a=>a.endsWith('tests/business-workflow-e2e.mjs')))process.exit(Number(process.env.TEST_E2E_EXIT||0));
 else if(args.some(a=>a.endsWith('tests/authenticated-smoke.mjs')))process.exit(0);
 else if(args.some(a=>a.endsWith('prepare-e2e-clone.mjs')||a.endsWith('harden-supabase-api.mjs')||a.endsWith('node_modules/prisma/build/index.js')))process.exit(0);
 else { const result=spawnSync(${JSON.stringify(process.execPath)},args,{stdio:'inherit',env:process.env});process.exit(result.status??1); }
}
`;
  await writeFile(path.join(bin, 'tool.mjs'), tool, { mode: 0o755 });
  for (const name of ['pg_dump','pg_restore','psql','createdb','dropdb','curl','lsof','sleep','node']) await cp(path.join(bin,'tool.mjs'),path.join(bin,name));
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
