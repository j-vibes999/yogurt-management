import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function fixture(valid = true) {
  let checks = 0;
  const response = type => ({type, headers:new Headers()});
  const exports = {};
  const code = ts.transpileModule(readFileSync('middleware.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,process:{env:{SESSION_SECRET:'synthetic'}},URL,fetch:async()=>{checks++;return {ok:true,json:async()=>({role:'admin',source:'database'})}},require:name=>({
    'next/server':{NextResponse:{next:()=>response('next'),json:()=>response('json')}},
    '@/lib/auth-session':{getSessionSecret:()=> 'synthetic',SESSION_COOKIE:'yogurt_session',verifySession:async()=>valid?{userId:'u',role:'admin'}:null},
    '@/lib/access-policy':{rolesForApi:()=>['admin'],rolesForPage:()=>['admin']},
    '@/lib/native-access':{isNativeResource:name=>['stores','inventory'].includes(name)},
  })[name]});
  return {checks:()=>checks, run:(pathname,method='GET')=>exports.middleware({method,headers:new Headers({host:'127.0.0.1:43188'}),cookies:{get:()=>({value:'synthetic'})},nextUrl:{pathname,search:'',port:'43188'}})};
}
test('native GET defers its fresh database authorization to the route without a second session HTTP call',async()=>{
  const f=fixture(); const result=await f.run('/api/native/v1/stores');
  assert.equal(result.type,'next'); assert.equal(f.checks(),0);
  assert.equal(result.headers.get('X-Frame-Options'),'DENY');
});
test('write and other API routes retain middleware database authorization',async()=>{
  for(const [route,method] of [['/api/native/v1/stores','POST'],['/api/stores','POST'],['/api/nav-counts','GET'],['/api/native/v1/unknown','GET']]) {
    const f=fixture();await f.run(route,method); assert.equal(f.checks(),1);
  }
});
test('native GET still rejects invalid cookies before reaching its route',async()=>{
  const f=fixture(false);assert.equal((await f.run('/api/native/v1/stores')).type,'json');assert.equal(f.checks(),0);
});
