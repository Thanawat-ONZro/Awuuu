import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker,{UploadBudget,MAX_BYTES} from '../src/core.mjs';
import {DOWNLOAD_SCRIPT} from '../src/download.mjs';

function environment(){
 const objects=new Map(),values=new Map();
 const storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},async transaction(fn){return fn(storage);}};
 const quota=new UploadBudget({storage},{MAX_UPLOADS_PER_DAY:'3',MAX_UPLOADS_PER_MINUTE_PER_IP:'2'});
 const env={SHARE_TTL_SECONDS:'86400',UPLOAD_BUDGET:{idFromName:v=>v,get:()=>quota},SHARES:{
  async put(key,bytes,options){objects.set(key,{key,bytes:new Uint8Array(bytes),customMetadata:options.customMetadata,size:bytes.length});},
  async get(key){const item=objects.get(key);return item?{...item,body:item.bytes}:null;},
  async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);},
  async list(){return{objects:Array.from(objects.values()),truncated:false};}
 }};return{env,objects};
}
function upload(bytes,ip='1.2.3.4') {return new Request('https://share.example/api/shares',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':String(bytes.length),'CF-Connecting-IP':ip},body:bytes});}
const envelope=()=>{const b=new Uint8Array(48);b.set(new TextEncoder().encode('AWU1'));return b;};

test('encrypted uploads return a share link and enforce authenticated revoke',async()=>{
 const {env,objects}=environment();const bytes=envelope();const response=await worker.fetch(upload(bytes),env);assert.equal(response.status,201);const created=await response.json();
 assert.ok(created.url.startsWith('https://share.example/s/'));assert.equal(new URL(created.url).hash,'');assert.equal(created.revokeToken.length,43);
 const api='https://share.example/api/shares/'+created.id;
 const downloaded=await worker.fetch(new Request(api),env);assert.equal(downloaded.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);
 assert.equal((await worker.fetch(new Request(api,{method:'DELETE'}),env)).status,403);
 assert.equal(objects.size,1);
 assert.equal((await worker.fetch(new Request(api,{method:'DELETE',headers:{authorization:'Bearer '+created.revokeToken}}),env)).status,200);
 assert.equal((await worker.fetch(new Request(api),env)).status,404);
});
test('oversize uploads, invalid IDs, expired objects and upload budgets are rejected',async()=>{
 const {env,objects}=environment();const oversized=upload(envelope());oversized.headers.set('content-length',String(MAX_BYTES+1));assert.equal((await worker.fetch(oversized,env)).status,413);
 assert.equal((await worker.fetch(new Request('https://share.example/api/shares/not-an-id'),env)).status,404);
 const a=await(await worker.fetch(upload(envelope()),env)).json();await worker.fetch(upload(envelope()),env);assert.equal((await worker.fetch(upload(envelope()),env)).status,429);
 const item=objects.get('files/'+a.id);item.customMetadata.expiresAtMs='1';assert.equal((await worker.fetch(new Request('https://share.example/api/shares/'+a.id),env)).status,404);
 await worker.fetch(upload(envelope(),'2.3.4.5'),env);assert.equal((await worker.fetch(upload(envelope(),'3.4.5.6'),env)).status,429);
});
test('download page decrypts the envelope in the browser and never sends the fragment key',async()=>{
 const key=crypto.getRandomValues(new Uint8Array(32)),nonce=crypto.getRandomValues(new Uint8Array(12));const name=new TextEncoder().encode('private.txt'),file=new TextEncoder().encode('a secret file');
 const plain=new Uint8Array(2+name.length+file.length);plain[0]=name.length;plain.set(name,2);plain.set(file,2+name.length);
 const aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:new TextEncoder().encode('Awuuu share v1')},aes,plain));
 const bytes=new Uint8Array(16+cipher.length);bytes.set(new TextEncoder().encode('AWU1'));bytes.set(nonce,4);bytes.set(cipher,16);
 let click,blob,downloadedName,requested;const status={textContent:''};const button={disabled:false,addEventListener(_type,fn){click=fn;}};
 const keyText=Buffer.from(key).toString('base64url');const location={hash:'#'+keyText,pathname:'/s/12345678-1234-4234-8234-123456789abc'};
 const document={querySelector:sel=>sel==='button'?button:status,createElement(){return{click(){downloadedName=this.download;}};}};
 vm.runInNewContext(DOWNLOAD_SCRIPT,{document,location,crypto,TextEncoder,TextDecoder,Uint8Array,Blob,Error,atob,fetch:async url=>{requested=url;return new Response(bytes);},URL:{createObjectURL:b=>{blob=b;return'blob:test';},revokeObjectURL(){}},setTimeout:fn=>fn()});
 await click();assert.equal(downloadedName,'private.txt');assert.equal(await blob.text(),'a secret file');assert.ok(!requested.includes(keyText));assert.equal(button.disabled,false);
});
test('scheduled cleanup removes expired ciphertext only',async()=>{
 const {env,objects}=environment();const created=await(await worker.fetch(upload(envelope()),env)).json();objects.set('files/old',{key:'files/old',customMetadata:{expiresAtMs:'1'}});await worker.scheduled({},env);assert.equal(objects.size,1);assert.ok(objects.has('files/'+created.id));
});
