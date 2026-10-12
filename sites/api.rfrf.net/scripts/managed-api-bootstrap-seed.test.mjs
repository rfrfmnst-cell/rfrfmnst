import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source=await readFile(new URL('./managed-api-bootstrap.cjs',import.meta.url),'utf8');
const releaseSha='21429a44b03ca83a13abb530fa8bb1509c57fded';
function run(env, { importFail=false, verifyFail=false, uid=1742 }={}) {
 const order=[],lines=[];const aborted=Symbol('aborted');
 const witness={event:'rafraf.client_storage_seed_verified',files:1,bytes:7,manifest_sha256:'sha256-v1:'+'a'.repeat(64),verified:true};
 const fake={env:{RAFRAF_RELEASE_SHA:releaseSha,...env},getuid:()=>uid,stdout:{write:value=>lines.push(value)},exit:code=>{order.push('exit:'+code);throw aborted;}};
 const helper={importPrivateStorageSeed:raw=>{assert.equal(fake.env.RAFRAF_CLIENT_STORAGE_SEED,undefined);order.push('import');if(importFail)throw new Error('PRIVATE_PAYLOAD');return witness;},verifyPrivateStorageSeed:()=>{order.push('verify');if(verifyFail)throw new Error('PRIVATE_PATH');return witness;},seedFailureCode:()=> 'SEED_CONFLICT'};
 try { runInNewContext(source,{process:fake,Date,require:name=>{
  order.push(name);assert.equal(fake.env.RAFRAF_CLIENT_STORAGE_SEED,undefined);
  if(name==='./managed-storage-seed.cjs')return helper;
  if(name==='./managed-storage-scheduler.cjs')return {scheduleStorageProbe:()=>order.push('scheduled')};
  if(name==='./dist/main.js')return {};
  throw new Error('Unexpected fixed require');
 },module:{parent:{}}}); } catch(error){if(error!==aborted)throw error;}
 return {order,lines,env:fake.env};
}
test('normal startup reads no witness and requires original app before scheduling diagnostic',()=>{
 const x=run({});assert.deepEqual(x.order,['./dist/main.js','./managed-storage-scheduler.cjs','scheduled']);assert.deepEqual(x.lines,[]);
});
test('seed env is consumed and deleted before helper or app imports even through host runner',()=>{
 const x=run({RAFRAF_CLIENT_STORAGE_SEED:'PRIVATE_PAYLOAD'});assert.deepEqual(x.order,['./managed-storage-seed.cjs','import','./dist/main.js','./managed-storage-scheduler.cjs','scheduled']);assert.ok(!x.lines.join('').includes('PRIVATE_PAYLOAD'));assert.equal(x.env.RAFRAF_CLIENT_STORAGE_SEED,undefined);
 const envelope=JSON.parse(x.lines[0]);assert.deepEqual(Object.keys(envelope).sort(),['level','message','timestamp']);assert.ok(Number.isFinite(Date.parse(envelope.timestamp)));const payload=JSON.parse(envelope.message);assert.deepEqual(Object.keys(payload).sort(),['bytes','event','files','manifest_sha256','release_sha','uid','verified']);assert.equal(payload.release_sha,releaseSha);assert.equal(payload.uid,1742);
});
test('verify true checks private durable witness with no seed; false flag does not',()=>{
 const yes=run({RAFRAF_CLIENT_STORAGE_VERIFY:'true'});assert.equal(yes.order[1],'verify');const no=run({RAFRAF_CLIENT_STORAGE_VERIFY:'false'});assert.ok(!no.order.includes('verify'));
});
test('seed import failure is fail closed with fixed code only before original startup',()=>{
 const x=run({RAFRAF_CLIENT_STORAGE_SEED:'PRIVATE_PAYLOAD'},{importFail:true});assert.ok(!x.order.includes('./dist/main.js'));assert.equal(x.order.at(-1),'exit:1');assert.ok(!x.lines.join('').includes('PRIVATE_PAYLOAD'));assert.equal(JSON.parse(JSON.parse(x.lines[0]).message).code,'SEED_CONFLICT');
});
test('temporary witness verification failure blocks startup; absence of flag removes availability trap',()=>{
 const x=run({RAFRAF_CLIENT_STORAGE_VERIFY:'true'},{verifyFail:true});assert.ok(!x.order.includes('./dist/main.js'));assert.ok(!x.lines.join('').includes('PRIVATE_PATH'));assert.ok(run({},{verifyFail:true}).order.includes('./dist/main.js'));
});
test('invalid or missing release identity is fail closed before importing storage or application',()=>{
 for(const value of [undefined,'21429a44','A'.repeat(40),'private release value']) {
  const x=run({RAFRAF_CLIENT_STORAGE_SEED:'PRIVATE_PAYLOAD',RAFRAF_RELEASE_SHA:value});assert.deepEqual(x.order,['exit:1']);assert.equal(JSON.parse(JSON.parse(x.lines[0]).message).code,'SEED_RELEASE_IDENTITY_REJECTED');assert.ok(!x.lines.join('').includes('PRIVATE_PAYLOAD'));assert.equal(x.env.RAFRAF_CLIENT_STORAGE_SEED,undefined);
 }
 assert.ok(run({RAFRAF_RELEASE_SHA:undefined}).order.includes('./dist/main.js'));
});
test('unavailable or invalid UID fails closed before storage while normal startup stays independent',()=>{
 for(const uid of [0,-1,NaN,1.5,'1742']) {
  const x=run({RAFRAF_CLIENT_STORAGE_VERIFY:'true'},{uid});assert.deepEqual(x.order,['exit:1']);assert.equal(JSON.parse(JSON.parse(x.lines[0]).message).code,'SEED_UID_REJECTED');
 }
 assert.ok(run({},{uid:-1}).order.includes('./dist/main.js'));
});
