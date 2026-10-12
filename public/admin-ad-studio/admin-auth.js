import {supabase} from '/supabase-client.js';
async function verify(){const {data:{user},error}=await supabase.auth.getUser();if(error||!user)throw Error('Administrator sign-in required.');const {data,error:roleError}=await supabase.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();if(roleError||!data)throw Error('Administrator access required.');return user}
window.adStudioAuthorization=async()=>{const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Sign in to your administrator account.');return 'Bearer '+session.access_token};
try{await verify();document.body.style.visibility='visible'}catch{window.top.location.replace('/admin.html#ad-studio-view')}
supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(!session&&event!=='INITIAL_SESSION')){document.body.style.visibility='hidden';window.top.location.replace('/admin.html#ad-studio-view')}});
