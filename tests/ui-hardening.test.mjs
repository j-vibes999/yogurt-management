import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(p,'utf8');

test('critical operational forms use React Hook Form',()=>{
  for(const file of ['src/components/material-edit-button.tsx','src/components/production-planner.tsx','src/components/restock-audit-form.tsx','src/components/expense-management.tsx']){
    assert.match(read(file),/react-hook-form/,`${file} must use react-hook-form`);
  }
});

test('shared and operational dialogs use Radix where migrated',()=>{
  for(const file of ['src/components/action-dialog.tsx','src/components/material-edit-button.tsx','src/components/expense-directory.tsx']){
    assert.match(read(file),/@radix-ui\/react-dialog/,`${file} must use Radix Dialog`);
  }
});

test('data-heavy operational tables use TanStack where sorting is useful',()=>{
  for(const file of ['src/components/settlement-directory.tsx','src/components/inventory-directory.tsx','src/components/expense-directory.tsx']){
    assert.match(read(file),/@tanstack\/react-table/,`${file} must use TanStack Table`);
    assert.match(read(file),/getSortedRowModel/);
  }
});

test('real-user telemetry captures anonymous device/network context',()=>{
  const reporter=read('src/components/web-vitals-reporter.tsx');
  const route=read('src/app/api/metrics/web-vitals/route.ts');
  const summary=read('scripts/web-vitals-summary.mjs');
  for(const token of ['viewport','connection','saveData']){assert.ok(reporter.includes(token));assert.ok(route.includes(token));}
  assert.ok(summary.includes('viewport\\tconnection\\tmetric'));
});

test('expense edit dialog stays above its overlay and locks background scroll',()=>{
  const css=read('src/app/globals.css');
  const component=read('src/components/expense-directory.tsx');
  assert.match(css,/\.expense-edit-backdrop-v22\{[\s\S]*?z-index:400!important;/);
  assert.match(css,/\.expense-edit-modal-v22\{[\s\S]*?z-index:401!important;/);
  assert.ok(component.includes('useModalScrollLock(Boolean(editing))'));
  assert.ok(!component.includes('expense-dialog-positioner-v43'));
  assert.ok(component.includes('onOpenAutoFocus'));
});

// The old six tests froze superseded font sizes and navigation clipping.
// Check the readability requirement independently of those appearance snapshots.
test('shared palette text and status pairs meet normal-text AA contrast',()=>{
  const css=read('src/app/professional.css');
  const root=css.match(/:root\s*\{([^}]+)\}/)?.[1]??'';
  const tokens=new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
  function luminance(color){
    assert.match(color,/^#[\da-f]{6}$/i,'contrast requires a concrete RGB token');
    const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  }
  const pairs=[
    ['--text','--bg'],['--muted','--bg'],['--muted','--surface-soft'],
    ['--surface','--primary'],['--sidebar-text','--sidebar'],
    ['--success','--success-soft'],['--warning','--warning-soft'],
    ['--danger','--danger-soft'],['--info','--info-soft'],
  ];
  for(const [fg,bg] of pairs){
    assert.ok(tokens.has(fg)&&tokens.has(bg),`missing ${fg}/${bg}`);
    const [low,high]=[luminance(tokens.get(fg)),luminance(tokens.get(bg))].sort((a,b)=>a-b);
    const contrast=(high+.05)/(low+.05);
    assert.ok(contrast>=4.5,`${fg}/${bg}: ${contrast.toFixed(2)}:1 is below 4.5:1`);
  }
});
