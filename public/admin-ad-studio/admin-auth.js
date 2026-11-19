import {supabase} from "/supabase-client.js";

function returnToAdmin() {
  document.body.style.visibility = "hidden";
  window.location.replace("/admin.html#ad-studio-view");
}

window.adStudioAuthorization = async () => {
  const {data: {session}} = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in to your administrator account.");
  return "Bearer " + session.access_token;
};

try {
  const {data, error} = await supabase.rpc("is_admin");
  if (error || data !== true) throw new Error("Administrator sign-in required.");
  document.body.style.visibility = "visible";
} catch {
  returnToAdmin();
}

supabase?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") returnToAdmin();
});
