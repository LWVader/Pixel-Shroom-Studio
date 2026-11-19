import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {SUPABASE_URL, SUPABASE_ANON_KEY} from "/admin-config.js";

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
}) : null;
