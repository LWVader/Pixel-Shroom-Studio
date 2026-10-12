import existingWorker from './worker.mjs';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './public/config.js';
import {handleSocial} from './lib/ad-studio-social.mjs';
const json=(message,status)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
export async function authenticatedAdmin(request,fetcher=fetch){
 const auth=request.headers.get('Authorization');if(!auth?.startsWith('Bearer '))return null;
 const headers={Authorization:auth,apikey:SUPABASE_ANON_KEY};
 const response=await fetcher(SUPABASE_URL+'/auth/v1/user',{headers,signal:AbortSignal.timeout(15000)});
 if(!response.ok)return null;const user=await response.json();if(!user.id)return null;
 const membership=await fetcher(SUPABASE_URL+'/rest/v1/admin_users?select=user_id&user_id=eq.'+encodeURIComponent(user.id),{headers,signal:AbortSignal.timeout(15000)});
 if(!membership.ok)return null;const rows=await membership.json();return Array.isArray(rows)&&rows.some(r=>r.user_id===user.id)?user:null;
}
export default{...existingWorker,async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname.startsWith('/api/ad-studio/social/')){
  if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return json('Same-origin requests required.',403);
  try{const user=await authenticatedAdmin(request);if(!user)return json('Administrator sign-in required.',401);
   const headers=new Headers(request.headers);headers.set('oai-authenticated-user-id',user.id);headers.set('oai-authenticated-user-email',user.email||'');
   return await handleSocial(new Request(request,{headers}),{...env,DB:env.AD_STUDIO_DB},url.pathname.split('/').at(-1));
  }catch{return json('Could not verify your administrator session. Please retry.',503)}
 }
 const response=await existingWorker.fetch(request,env,ctx);
 if(url.pathname.startsWith('/admin-ad-studio/')){
  const secured=new Response(response.body,response);secured.headers.set('X-Frame-Options','SAMEORIGIN');secured.headers.set('X-Robots-Tag','noindex,nofollow');secured.headers.set('Cache-Control','no-store');
  if(secured.headers.get('Content-Type')?.includes('text/html'))secured.headers.set('Content-Security-Policy',"frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  return secured;
 }
 return response;
}};
