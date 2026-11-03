import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchLatestCommand, modeMasterId } from '../tracking/commands';

export function useDogModes(owner, dogs, authorizedMasters = []) {
  const [commands, setCommands] = useState({});
  const devices = JSON.stringify(dogs.map(dog => [modeMasterId(dog, authorizedMasters), dog.id]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  useEffect(() => {
    let active = true, busy = false, controller;
    async function refresh() {
      if (!owner || !supabase || busy || document.visibilityState === 'hidden') return;
      if (!navigator.onLine) {
        setCommands(old => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, { ...value, ready: false }])));
        return;
      }
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const entries = await Promise.all(JSON.parse(devices).map(async ([masterId, slaveId]) => {
          try {
            const command = await fetchLatestCommand(supabase, controller.signal, masterId, slaveId);
            return [`${masterId}:${slaveId}`, { command, masterId, ready: true }];
          } catch { return [`${masterId}:${slaveId}`, { command: null, masterId, ready: false }]; }
        }));
        if (active) setCommands(old => Object.fromEntries(entries.map(([key, value]) =>
          [key, value.ready ? value : { ...value, command: old[key]?.command ?? null }])));
      } finally { clearTimeout(timeout); busy = false; }
    }
    refresh();
    const timer = setInterval(refresh, 3000);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false; controller?.abort(); clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [owner, devices]);
  return commands;
}
