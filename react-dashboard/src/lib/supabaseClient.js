import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export let supabase = null;
export let supabaseConfigError = '';

if (!supabaseUrl || !supabasePublishableKey) {
  supabaseConfigError = '網站尚未完成連線設定，請聯絡網站管理員。';
} else {
  try {
    supabase = createClient(supabaseUrl, supabasePublishableKey);
  } catch {
    supabaseConfigError = '網站連線設定有誤，請聯絡網站管理員。';
  }
}
