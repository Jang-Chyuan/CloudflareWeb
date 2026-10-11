import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useDogNames(owner) {
  const [aliases, setAliases] = useState({}), [error, setError] = useState('');
  const active = useRef(false);
  useEffect(() => {
    let alive = true, busy = false;
    active.current = true;
    const controller = new AbortController();
    async function refresh() {
      if (busy || !navigator.onLine || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const { data, error: failure } = await supabase.from('slave_names').select('slave_id,name').abortSignal(controller.signal);
        if (failure) throw failure;
        if (alive) { setAliases(Object.fromEntries((data ?? []).map(row => [row.slave_id, row.name]))); setError(''); }
      } catch { if (alive) setError('犬隻名稱讀取失敗，請確認 Supabase 連線。'); }
      finally { busy = false; }
    }
    refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false; active.current = false; controller.abort(); clearInterval(interval);
      window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh);
    };
  }, [owner]);
  async function saveName(slaveId, masterId, name) {
    const value = name.trim();
    if (value.length > 20) throw new Error('名稱最多 20 個字。');
    const { data, error: failure } = await supabase.from('slave_names').upsert({
      slave_id: slaveId, master_id: masterId, name: value, updated_at: new Date().toISOString(),
    }, { onConflict: 'slave_id' }).select('slave_id,name').single();
    if (failure) throw new Error('名稱儲存失敗，請確認網路及 Master 授權。');
    if (active.current) setAliases(old => ({ ...old, [data.slave_id]: data.name }));
  }
  return { aliases, error, saveName };
}
