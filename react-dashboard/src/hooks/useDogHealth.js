import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchDogHealth } from '../tracking/cloud';

export function useDogHealth(owner, dogs) {
  const [health, setHealth] = useState({}), [error, setError] = useState('');
  const devices = JSON.stringify(dogs.map(dog => [dog.masterId, dog.id]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  useEffect(() => {
    let active = true, busy = false, controller;
    setHealth({}); setError('');
    async function refresh() {
      if (!owner || !supabase || busy || !navigator.onLine || document.visibilityState === 'hidden') return;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const entries = await Promise.all(JSON.parse(devices).map(async ([masterId, slaveId]) =>
          [slaveId, await fetchDogHealth(supabase, masterId, slaveId, controller.signal)]));
        if (active) { setHealth(Object.fromEntries(entries)); setError(''); }
      } catch {
        if (active) { setHealth({}); setError('健康資料讀取失敗，請確認 dog_health 讀取權限及網路連線。'); }
      } finally { clearTimeout(timeout); busy = false; }
    }
    refresh();
    const interval = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      active = false; controller?.abort(); clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [owner, devices]);
  return { health, error };
}
