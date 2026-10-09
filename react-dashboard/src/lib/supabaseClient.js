import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    '請在 .env.local 設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY，並重新啟動開發伺服器。',
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
