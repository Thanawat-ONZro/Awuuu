// No external scripts, analytics, image requests or decryption key sent to the server.
export const DOWNLOAD_SCRIPT = `
const button=document.querySelector('button'), status=document.querySelector('[role=status]');
button.addEventListener('click',async()=>{
 button.disabled=true;
 let objectUrl;
 try {
  status.textContent='Downloading and decrypting…';
  const keyText=location.hash.slice(1);
  if(!/^[A-Za-z0-9_-]{43}$/.test(keyText))throw Error('This link is missing its decryption key. Ask the sender for the complete link.');
  const id=location.pathname.split('/').pop();
  const response=await fetch('/api/shares/'+id,{referrerPolicy:'no-referrer',cache:'no-store'});
  if(!response.ok)throw Error(response.status===404?'This link has expired or was removed.':'The download is unavailable. Try again later.');
  const encrypted=new Uint8Array(await response.arrayBuffer());
  if(encrypted.length<32 || new TextDecoder().decode(encrypted.slice(0,4))!=='AWU1')throw Error('Invalid download.');
  const raw=Uint8Array.from(atob(keyText.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const data=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:encrypted.slice(4,16),additionalData:new TextEncoder().encode('Awuuu share v1')},key,encrypted.slice(16)));
  const length=data[0]+data[1]*256;
  if(length<1 || length>240 || data.length<length+2)throw Error('Invalid file metadata.');
  const name=new TextDecoder().decode(data.slice(2,2+length)).replace(/[\\\\/:*?"<>|\\x00-\\x1f]/g,'_')||'download';
  objectUrl=URL.createObjectURL(new Blob([data.slice(2+length)],{type:'application/octet-stream'}));
  const anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=name;anchor.click();
  status.textContent='Ready: '+name+'. Anyone with the complete link can download until it expires or is revoked.';
 }catch(error){status.textContent=error.message||'Download failed.';}
 finally{button.disabled=false;if(objectUrl)setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);}
});`;
export const DOWNLOAD_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Awuuu · Shared file</title>
<style>body{margin:0;background:#151310;color:#f5eee5;font:16px/1.65 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}main{max-width:540px;padding:40px 24px}h1{font-size:30px}p{color:#c0b6a8}button{font:inherit;border:0;border-radius:12px;padding:12px 20px;background:#e9b68c;color:#211911;cursor:pointer}button:disabled{opacity:.5}small{display:block;margin-top:24px;color:#9c9285}a{color:inherit}</style>
<main><small>AWUUU · TEMPORARY FILE</small><h1>A file for you.</h1><p>Your browser decrypts the file using the key in this link. No account or Awuuu installation is needed.</p><button>Download file</button><p role="status" aria-live="polite">The link normally expires after 24 hours. Keep the complete link private.</p><small>The sender can revoke this link. Only download files from someone you trust.</small></main><script>${DOWNLOAD_SCRIPT}</script></html>`;
