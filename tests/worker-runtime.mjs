// Exercise the real Cloudflare asset binding, not the fixture asset server.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const origin='http://127.0.0.1:8022';
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--port','8022'],{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data.toString();});
try{
 let ready=false;
 for(let attempt=0;attempt<80;attempt++){if(child.exitCode!==null)throw Error(output);try{const r=await fetch(origin+'/robots.txt');if(r.ok){ready=true;break;}}catch{}await delay(250);}
 assert(ready,'Wrangler did not become ready: '+output);
 const home=await fetch(origin+'/');assert.equal(home.status,200,'Homepage must resolve index.html with actual html_handling=none');assert((await home.text()).includes('hero-1280.webp'));
 for(const genre of ['portrait','fantasy','landscape','sci-fi','abstract','dreamscape','dark-fantasy','horror','nft']){const r=await fetch(origin+'/genre.html?genre='+genre);assert.equal(r.status,200,genre);assert(r.headers.get('link').includes('genre='+genre));}
 for(const path of ['/faq.html','/contact.html','/verify.html','/admin.html','/checkout-success.html','/app.js','/storefront.css','/assets/hero-1280.webp','/sitemap.xml'])assert.equal((await fetch(origin+path)).status,200,path);
 for(const path of ['/index.html','/artwork.html','/genres/fantasy.html','/genre/fantasy']){const r=await fetch(origin+path,{redirect:'manual'});assert.equal(r.status,301,path);assert.equal((await fetch(r.headers.get('location'))).status,200,path+' final');}
 assert.equal((await fetch(origin+'/missing')).status,404);
 assert.equal((await fetch(origin+'/genre.html?genre=bad')).status,404);
 const head=await fetch(origin+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await fetch(origin+'/',{method:'POST'})).status,405);
 console.log('PASS: actual Wrangler/workerd binding homepage, nine genres, utilities/assets, redirects,404,HEAD and method rejection.');
}catch(error){console.error(output);throw error;}finally{child.kill('SIGTERM');}
