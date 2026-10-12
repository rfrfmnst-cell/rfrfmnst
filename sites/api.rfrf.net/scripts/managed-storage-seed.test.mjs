import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { importPrivateStorageSeed: apply, verifyPrivateStorageSeed: verify, seedFailureCode } = require('./managed-storage-seed.cjs');
const hash = x => createHash('sha256').update(x).digest('hex');
const record = (key='customer/thread/a.png', bytes=Buffer.from('synthetic-evidence')) => ({ key, base64:bytes.toString('base64'),size:bytes.length,sha256:hash(bytes) });
const payload = (evidence=[record()], supplier_documents=[]) => JSON.stringify({version:1,evidence,supplier_documents});
function fixture() {
  const root=fs.mkdtempSync('/workspace/.deployment/seed-test-');fs.chmodSync(root,0o700);
  fs.mkdirSync(path.join(root,'home'),{mode:0o755});fs.mkdirSync(path.join(root,'home/u374306905'),{mode:0o700});
  const io={...fs,openSync:(p,...args)=>fs.openSync(p==='/'?root:p,...args)};
  const storage=path.join(root,'home/u374306905/.rafraf-storage');
  const evidence=path.join(storage,'rfq-evidence');
  const close=()=>fs.rmSync(root,{recursive:true,force:true});
  const options={io,uid:process.getuid()};
  return {root,io,storage,evidence,close,options,file:key=>path.join(evidence,key)};
}
function run(fn) { const f=fixture();try{return fn(f);}finally{f.close();} }
function rejected(f, raw) { assert.throws(()=>apply(raw,f.options)); }
test('imports synthetic bytes into fixed private roots and verifies durable metadata without base64',()=>run(f=>{
 const result=apply(payload(),f.options);assert.deepEqual(Object.keys(result).sort(),['bytes','event','files','manifest_sha256','verified']);assert.equal(result.files,1);assert.equal(result.verified,true);
 assert.equal(fs.readFileSync(f.file('customer/thread/a.png'),'utf8'),'synthetic-evidence');
 for(const p of [f.storage,f.evidence,path.dirname(f.file('customer/thread/a.png'))])assert.equal(fs.statSync(p).mode&0o7777,0o700);
 assert.equal(fs.statSync(f.file('customer/thread/a.png')).mode&0o7777,0o600);
 const manifest=path.join(f.storage,'.client-storage-seed-manifest.json');assert.equal(fs.statSync(manifest).mode&0o7777,0o600);assert.ok(!fs.readFileSync(manifest,'utf8').includes('base64'));
 assert.deepEqual(verify(f.options),result);
}));
test('same bytes and metadata repeat without rewriting files or manifest',()=>run(f=>{
 const one=apply(payload(),f.options),before=fs.statSync(f.file('customer/thread/a.png'));const two=apply(payload(),f.options),after=fs.statSync(f.file('customer/thread/a.png'));
 assert.deepEqual(two,one);assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.ctimeMs,before.ctimeMs);
}));
test('valid historical supplier category and zero-byte object preserve exact keys',()=>run(f=>{
 const r=record('supplier1/FREELANCE_CERTIFICATE/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',Buffer.alloc(0));
 const result=apply(payload([], [r]),f.options);assert.equal(result.files,1);assert.equal(result.bytes,0);assert.deepEqual(verify(f.options),result);
}));
test('path escapes, backslashes, unsupported extensions and supplier categories fail before filesystem writes',()=>run(f=>{
 for(const key of ['../thread/a.png','customer/../a.png','customer/thread/a.png/../../x','customer\\thread\\a.png','customer/thread/a.jpeg'])rejected(f,payload([record(key)]));
 rejected(f,payload([], [record('supplier1/UNKNOWN/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')]));assert.ok(!fs.existsSync(f.storage));
}));
test('unknown schema fields and versions fail before filesystem access',()=>run(f=>{
 for(const raw of ['null','{','{"version":2,"evidence":[],"supplier_documents":[]}',JSON.stringify({...JSON.parse(payload()),extra:'private-value'})])rejected(f,raw);
 const r=record();r.extra='private-value';rejected(f,payload([r]));assert.ok(!fs.existsSync(f.storage));
}));
test('JSON, total bytes, file count and key-length limits are enforced',()=>run(f=>{
 rejected(f,' '.repeat(49153));rejected(f,payload([record('customer/thread/a.png',Buffer.alloc(32769))]));
 rejected(f,payload(Array.from({length:129},(_,i)=>record(`customer/thread/a${String(i).padStart(3,'0')}.png`,Buffer.alloc(0)))));
 rejected(f,payload([record('a'.repeat(510)+'/b/c.png',Buffer.alloc(0))]));assert.ok(!fs.existsSync(f.storage));
}));
test('base64 must be canonical and exact size and hash must match',()=>run(f=>{
 for(const change of [{base64:'YQ'},{base64:'YR=='},{size:1},{sha256:'f'.repeat(64)},{sha256:'A'.repeat(64)}])rejected(f,payload([{...record(),...change}]));assert.ok(!fs.existsSync(f.storage));
}));
test('duplicate and unsorted per-store keys are rejected before writes',()=>run(f=>{
 rejected(f,payload([record(),record()]));rejected(f,payload([record('customer/thread/b.png'),record('customer/thread/a.png')]));assert.ok(!fs.existsSync(f.storage));
}));
test('storage directory symlink cannot redirect writes',()=>run(f=>{
 const outside=path.join(f.root,'outside');fs.mkdirSync(outside,{mode:0o700});fs.symlinkSync(outside,f.storage);rejected(f,payload());assert.deepEqual(fs.readdirSync(outside),[]);
}));
test('key-directory symlink cannot redirect writes',()=>run(f=>{
 apply(payload([],[]),f.options);const outside=path.join(f.root,'outside');fs.mkdirSync(outside,{mode:0o700});fs.symlinkSync(outside,path.join(f.evidence,'customer'));
 assert.throws(()=>apply(payload(),f.options));assert.deepEqual(fs.readdirSync(outside),[]);
}));
test('existing broad private-root permissions are rejected without chmod',()=>run(f=>{
 fs.mkdirSync(f.storage,{mode:0o755});fs.chmodSync(f.storage,0o755);rejected(f,payload());assert.equal(fs.statSync(f.storage).mode&0o7777,0o755);
}));
test('foreign home owner is rejected without creating private storage',()=>run(f=>{
 const native=f.io.fstatSync;f.io.fstatSync=fd=>{const stat=native(fd);const target=fs.readlinkSync('/proc/self/fd/'+fd);if(target.endsWith('/u374306905'))return Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,{uid:stat.uid+1});return stat;};
 rejected(f,payload());assert.ok(!fs.existsSync(f.storage));
}));
test('existing object symlinks and hardlinks are rejected without reading or changing target bytes',()=>run(f=>{
 fs.mkdirSync(path.dirname(f.file('customer/thread/a.png')),{recursive:true,mode:0o700});fs.chmodSync(f.storage,0o700);fs.mkdirSync(path.join(f.storage,'supplier-documents'),{mode:0o700});
 const outside=path.join(f.root,'outside');fs.writeFileSync(outside,'synthetic-evidence',{mode:0o600});fs.symlinkSync(outside,f.file('customer/thread/a.png'));rejected(f,payload());assert.equal(fs.readFileSync(outside,'utf8'),'synthetic-evidence');
 fs.unlinkSync(f.file('customer/thread/a.png'));fs.linkSync(outside,f.file('customer/thread/a.png'));rejected(f,payload());assert.equal(fs.statSync(outside).nlink,2);assert.equal(fs.readFileSync(outside,'utf8'),'synthetic-evidence');
}));
test('existing differing bytes are not overwritten; preflight prevents partial new object creation',()=>run(f=>{
 fs.mkdirSync(path.dirname(f.file('customer/thread/b.png')),{recursive:true,mode:0o700});fs.chmodSync(f.storage,0o700);fs.mkdirSync(path.join(f.storage,'supplier-documents'),{mode:0o700});fs.writeFileSync(f.file('customer/thread/b.png'),'conflict',{mode:0o600});
 rejected(f,payload([record('customer/thread/a.png'),record('customer/thread/b.png')]));assert.ok(!fs.existsSync(f.file('customer/thread/a.png')));assert.equal(fs.readFileSync(f.file('customer/thread/b.png'),'utf8'),'conflict');
}));
test('partial I/O failure rolls back only files created by the current import',()=>run(f=>{
 const native=f.io.writeSync;let calls=0;f.io.writeSync=(...args)=>{if(++calls===2)throw Object.assign(new Error('private-path'),{code:'ENOSPC'});return native(...args);};
 rejected(f,payload([record('customer/thread/a.png'),record('customer/thread/b.png')]));assert.ok(!fs.existsSync(f.file('customer/thread/a.png')));assert.ok(!fs.existsSync(f.file('customer/thread/b.png')));assert.ok(!fs.existsSync(path.join(f.storage,'.client-storage-seed-manifest.json')));
}));
test('short writes are completed and zero-byte writes fail closed with cleanup',()=>run(f=>{
 const native=f.io.writeSync;f.io.writeSync=(fd,buffer,offset,length,position)=>native(fd,buffer,offset,Math.min(length,3),position);apply(payload(),f.options);assert.equal(verify(f.options).files,1);
 const g=fixture();try{g.io.writeSync=()=>0;rejected(g,payload());assert.ok(!fs.existsSync(g.file('customer/thread/a.png')));}finally{g.close();}
}));
test('manifest conflict cannot replace accepted metadata or mutate accepted bytes',()=>run(f=>{
 apply(payload(),f.options);const before=fs.readFileSync(path.join(f.storage,'.client-storage-seed-manifest.json'));rejected(f,payload([record('customer/thread/b.png')]));assert.deepEqual(fs.readFileSync(path.join(f.storage,'.client-storage-seed-manifest.json')),before);assert.ok(!fs.existsSync(f.file('customer/thread/b.png')));
}));
test('temporary witness detects object deletion, content changes and manifest symlink or malformed content',()=>run(f=>{
 apply(payload(),f.options);fs.writeFileSync(f.file('customer/thread/a.png'),'modified',{mode:0o600});assert.throws(()=>verify(f.options));fs.unlinkSync(f.file('customer/thread/a.png'));assert.throws(()=>verify(f.options));
 const manifest=path.join(f.storage,'.client-storage-seed-manifest.json');fs.unlinkSync(manifest);fs.symlinkSync(path.join(f.root,'outside'),manifest);assert.throws(()=>verify(f.options));fs.unlinkSync(manifest);fs.writeFileSync(manifest,'{"secret":"do-not-log"}',{mode:0o600});assert.throws(()=>verify(f.options));
}));
test('failure mapper never exposes private exception messages, paths, keys or payload',()=>{
 assert.equal(seedFailureCode(new Error('private/file base64')), 'SEED_FILESYSTEM_FAILURE');assert.equal(seedFailureCode({seedCode:'private-key'}),'SEED_FILESYSTEM_FAILURE');assert.equal(seedFailureCode({seedCode:'SEED_CONFLICT'}),'SEED_CONFLICT');
});
test('witness digest matches cutover compact sorted ASCII record format with fixed store enums',()=>run(f=>{
 const evidence=record();const document=record('supplier1/BUSINESS_REGISTRATION/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',Buffer.from('synthetic-document'));
 const canonical=[{bytes:evidence.size,key:evidence.key,sha256:evidence.sha256,store:'evidence'},{bytes:document.size,key:document.key,sha256:document.sha256,store:'supplier_documents'}];
 const expected='sha256-v1:'+hash(Buffer.from(JSON.stringify(canonical),'utf8'));
 const result=apply(payload([evidence],[document]),f.options);assert.equal(result.manifest_sha256,expected);assert.equal(verify(f.options).manifest_sha256,expected);
}));
