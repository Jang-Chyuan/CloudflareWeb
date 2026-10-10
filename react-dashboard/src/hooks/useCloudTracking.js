import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchTelemetry, listMasters, mergeRows, readFixedLocations } from '../tracking/cloud';
import { DAY } from '../tracking/telemetry';

export function useAuth() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(!supabase);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let active = true, authChanged = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, value) => {
      authChanged = true;
      if (active) { setSession(value); setReady(true); }
    });
    supabase.auth.getSession().then(({ data, error: failure }) => {
      if (!active || authChanged) return;
      setSession(data.session); setReady(true);
      if (failure) setError('無法恢復登入，請重新登入。');
    }).catch(() => { if (active) { setReady(true); setError('無法恢復登入，請重新登入。'); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return { session, ready, error };
}

export function useCloudTracking(owner) {
  const [rows, setRows] = useState([]);
  const [masters, setMasters] = useState([]);
  const [fixedLocations, setFixedLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const refreshRef = useRef(() => {});
  const fixedRefreshRef = useRef(() => {});

  // Settings must not wait for a potentially large telemetry download.
  useEffect(() => {
    if (!owner || !supabase) return;
    let active = true, busy = false, pending = false, controller;
    setFixedLocations([]);
    setWarning('');
    async function refreshFixed() {
      if (!active || document.visibilityState === 'hidden' || !navigator.onLine) return;
      if (busy) { pending = true; return; }
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const fixed = await readFixedLocations(supabase, null, controller.signal);
        if (!active || controller.signal.aborted) return;
        setWarning(fixed.warning);
        if (!fixed.warning) setFixedLocations(fixed.locations);
      } catch {
        if (active) setWarning('固定位置設定讀取失敗；保留上次成功讀取的設定。');
      } finally {
        clearTimeout(timeout); busy = false;
        if (active && pending) { pending = false; refreshFixed(); }
      }
    }
    fixedRefreshRef.current = refreshFixed;
    refreshFixed();
    const interval = setInterval(refreshFixed, 10000);
    const resume = () => { if (document.visibilityState === 'visible') refreshFixed(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false; controller?.abort(); clearInterval(interval);
      fixedRefreshRef.current = () => {};
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [owner]);

  useEffect(() => {
    if (!owner || !supabase) return;
    let active = true, busy = false, cursor = null, reconciledAt = 0, knownMasters = '';
    let controller;
    async function refresh(force = false) {
      if (!active || busy || document.visibilityState === 'hidden' || !navigator.onLine) return;
      busy = true;
      controller = new AbortController();
      // Finite requests, including initial and historical downloads.
      const timeout = setTimeout(() => controller.abort(), 120000);
      setLoading(true); setError(''); setProgress(0);
      try {
        const now = Date.now();
        const ids = await listMasters(supabase, owner, controller.signal);
        if (!active) return;
        const full = force || !cursor || now - reconciledAt >= 600000 || ids.join(',') !== knownMasters;
        const start = full ? now - DAY : Math.max(now - DAY, cursor - 300000);
        const incoming = await fetchTelemetry({ client: supabase, masterIds: ids, start, end: now,
          signal: controller.signal, onProgress: count => { if (active) setProgress(count); } });
        if (!active || controller.signal.aborted) return;
        setMasters(ids); setRows(old => mergeRows(full ? [] : old.filter(row => ids.includes(row.master_id)), incoming, now));
        setLastSync(now);
        cursor = now; knownMasters = ids.join(',');
        if (full) reconciledAt = now;
      } catch (failure) {
        if (active) setError(controller.signal.aborted ? '讀取逾時，請重試或確認網路連線。' : failure.message);
      } finally {
        clearTimeout(timeout); busy = false;
        if (active) setLoading(false);
      }
    }
    refreshRef.current = () => refresh(true);
    refresh();
    const interval = setInterval(() => refresh(), 30000);
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false; controller?.abort(); clearInterval(interval);
      document.removeEventListener('visibilitychange', resume); refreshRef.current = () => {};
      window.removeEventListener('online', resume);
    };
  }, [owner]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const refreshFixed = useCallback(() => fixedRefreshRef.current(), []);
  return { rows, masters, fixedLocations, loading, progress, lastSync, error, warning, refresh, refreshFixed };
}

export function usePreferences(owner) {
  const key = `dogtracker-web-preferences:${owner}`;
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key)) ?? {};
      return {
        aliases: saved.aliases && typeof saved.aliases === 'object' ? saved.aliases : {},
        hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(Number.isInteger) : [],
        trails: saved.trails !== false,
        windowMinutes: [3, 10, 30, 60, 360, 1440].includes(saved.windowMinutes) ? saved.windowMinutes : 10,
      };
    } catch { return { aliases: {}, hidden: [], trails: true, windowMinutes: 10 }; }
  });
  const save = patch => setPreferences(old => {
    const value = { ...old, ...patch };
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences remain usable when storage is unavailable. */ }
    return value;
  });
  return [preferences, save];
}
