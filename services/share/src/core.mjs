import { DOWNLOAD_HTML, DOWNLOAD_SCRIPT } from './download.mjs';
// Runtime-independent handlers also exercised by Node's built-in test runner.

export const MAX_BYTES = 25 * 1024 * 1024 + 1024;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const headers = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY' };
const json = (value, status=200) => Response.json(value,{status,headers});
export const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const token = () => { const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); };
const positive = (value, fallback, max) => Math.max(1,Math.min(max,Number.parseInt(value,10)||fallback));

/** A single operator-wide budget: atomic daily storage cap and per-IP upload throttling. */
export class UploadBudget {
  constructor(state, env) { this.state=state;this.env=env; }
  async fetch(request) {
    const {ip}=await request.json();const now=Date.now(),day=Math.floor(now/86400000),minute=Math.floor(now/60000);
    const allowed=await this.state.storage.transaction(async storage=>{
      let current=await storage.get('budget');
      if(!current || current.day!==day)current={day,count:0,minute,ips:{}};
      if(current.minute!==minute){current.minute=minute;current.ips={};}
      const dayMax=positive(this.env.MAX_UPLOADS_PER_DAY,100,10000),ipMax=positive(this.env.MAX_UPLOADS_PER_MINUTE_PER_IP,3,100);
      if(current.count>=dayMax || (current.ips[ip]||0)>=ipMax)return false;
      current.count++;current.ips[ip]=(current.ips[ip]||0)+1;await storage.put('budget',current);return true;
    });
    return json({allowed},allowed?200:429);
  }
}

async function boundedBody(request) {
  const declared=Number(request.headers.get('content-length'));
  if(!Number.isSafeInteger(declared)||declared<32||declared>MAX_BYTES)throw new Error('size');
  const reader=request.body?.getReader();if(!reader)throw new Error('size');
  const parts=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES||size>declared){await reader.cancel();throw new Error('size');}parts.push(value);}
  if(size!==declared)throw new Error('size');
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  if(new TextDecoder().decode(bytes.slice(0,4))!=='AWU1')throw new Error('format');return bytes;
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health')return json({service:'awuuu-share',version:1,maxBytes:25*1024*1024,encrypted:true});
    if(request.method==='GET'&&/^\/s\//.test(url.pathname)) {
      if(!ID.test(url.pathname.slice(3)))return new Response('Not found',{status:404,headers});
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(DOWNLOAD_SCRIPT));
      const hash=btoa(String.fromCharCode(...new Uint8Array(digest)));
      return new Response(DOWNLOAD_HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`}});
    }
    if(request.method==='POST'&&url.pathname==='/api/shares') {
      if(request.headers.get('content-type')!=='application/octet-stream')return json({error:'Encrypted binary upload required'},415);
      const declared=Number(request.headers.get('content-length'));if(!Number.isSafeInteger(declared)||declared<32||declared>MAX_BYTES)return json({error:'Maximum file size is 25 MB'},413);
      const budget=env.UPLOAD_BUDGET.get(env.UPLOAD_BUDGET.idFromName('global'));
      const allowed=await budget.fetch(new Request('https://budget/',{method:'POST',body:JSON.stringify({ip:await sha(request.headers.get('CF-Connecting-IP')||'unknown')})}));
      if(!allowed.ok)return json({error:'Upload limit reached. Try again later.'},429);
      let bytes;try{bytes=await boundedBody(request);}catch{return json({error:'Invalid upload or file too large'},413);}
      const id=crypto.randomUUID(),revokeToken=token(),expiresAtMs=Date.now()+positive(env.SHARE_TTL_SECONDS,86400,86400)*1000;
      await env.SHARES.put('files/'+id,bytes,{customMetadata:{expiresAtMs:String(expiresAtMs),revokeHash:await sha(revokeToken)},httpMetadata:{contentType:'application/octet-stream'}});
      return json({id,url:url.origin+'/s/'+id,revokeToken,expiresAtMs},201);
    }
    const match=/^\/api\/shares\/(.+)$/.exec(url.pathname);
    if(match&&ID.test(match[1])&&(request.method==='GET'||request.method==='DELETE')) {
      const key='files/'+match[1],object=await env.SHARES.get(key);
      if(!object)return json({error:'Expired or removed'},404);
      const expires=Number(object.customMetadata?.expiresAtMs);
      if(!Number.isFinite(expires)||expires<=Date.now()) {await env.SHARES.delete(key);return json({error:'Expired or removed'},404);}
      if(request.method==='DELETE'){
        const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
        if(!bearer||await sha(bearer)!==object.customMetadata?.revokeHash)return json({error:'Not authorized'},403);
        await env.SHARES.delete(key);return json({removed:true});
      }
      return new Response(object.body,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(object.size)}});
    }
    return json({error:'Not found'},404);
  },
  async scheduled(_event,env) {
    let cursor;
    do {
      const page=await env.SHARES.list({prefix:'files/',include:['customMetadata'],limit:1000,cursor});
      const expired=page.objects.filter(o=>Number(o.customMetadata?.expiresAtMs||0)<=Date.now()).map(o=>o.key);
      if(expired.length)await env.SHARES.delete(expired);
      cursor=page.truncated?page.cursor:undefined;
    }while(cursor);
  }
};
