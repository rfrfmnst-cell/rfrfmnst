import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {installManagedActionOrigin}=require('./managed-action-origin.cjs');

function fixture(address){
 const environment={__NEXT_PRIVATE_ORIGIN:'before-listen'};const calls=[];
 class Server extends EventEmitter{address(){return address;}}
 function original(...args){calls.push(args);queueMicrotask(()=>this.emit('listening'));return this;}
 Server.prototype.listen=original;
 return{http:{Server},environment,calls,original};
}
test('Unix socket self-fetch uses fixed HTTPS after Next initializes its invalid TCP origin',async()=>{
 const f=fixture('/tmp/fixture-passenger.sock');installManagedActionOrigin('https://supplier.rfrf.net',f);const server=new f.http.Server();
 server.on('listening',()=>{f.environment.__NEXT_PRIVATE_ORIGIN='http://0.0.0.0:3000';});
 const callback=()=>{};assert.equal(server.listen(3000,'0.0.0.0',callback),server);await new Promise(queueMicrotask);
 assert.equal(f.environment.__NEXT_PRIVATE_ORIGIN,'https://supplier.rfrf.net');assert.deepEqual(f.calls,[[3000,'0.0.0.0',callback]]);assert.equal(f.http.Server.prototype.listen,f.original);
});
test('normal TCP listener preserves the origin chosen by Next',async()=>{
 const f=fixture({address:'127.0.0.1',port:3219});installManagedActionOrigin('https://rfrf.net',f);const server=new f.http.Server();server.on('listening',()=>{f.environment.__NEXT_PRIVATE_ORIGIN='http://127.0.0.1:3219';});server.listen(3219);await new Promise(queueMicrotask);assert.equal(f.environment.__NEXT_PRIVATE_ORIGIN,'http://127.0.0.1:3219');
});
test('untrusted origins cannot redirect authenticated internal requests',()=>{
 for(const origin of ['https://example.org','http://supplier.rfrf.net','https://supplier.rfrf.net.example.org','https://supplier.rfrf.net/path','https://supplier.rfrf.net:444']){const f=fixture('/tmp/test');assert.throws(()=>installManagedActionOrigin(origin,f),/MANAGED_ACTION_ORIGIN_INVALID/);assert.equal(f.http.Server.prototype.listen,f.original);}
});
test('additional listeners are untouched after initial startup',async()=>{
 const f=fixture('/tmp/test');installManagedActionOrigin('https://rfrf.net',f);const first=new f.http.Server();first.listen();await new Promise(queueMicrotask);f.environment.__NEXT_PRIVATE_ORIGIN='unchanged';new f.http.Server().listen();await new Promise(queueMicrotask);assert.equal(f.environment.__NEXT_PRIVATE_ORIGIN,'unchanged');
});
