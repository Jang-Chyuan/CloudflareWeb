import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchTelemetry, listMasters, mergeRows, fetchLastGpsFix } from '../tracking/cloud';
import { DAY, buildDogs } from '../tracking/telemetry';

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
  const [historicalFixes, setHistoricalFixes] = useState([]);
  const [gpsWarning, setGpsWarning] = useState('');
  const gpsQueryTimes = useRef(new Map());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState('');
  const refreshRef = useRef(() => {});
  useEffect(() => { gpsQueryTimes.current.clear(); setHistoricalFixes([]); setGpsWarning(''); }, [owner]);
  useEffect(() => {
    if (!owner || !supabase || !masters.length) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const now = Date.now();
    const candidates = buildDogs(rows, [], now).filter(dog => dog.stale
      && now - (gpsQueryTimes.current.get(dog.id) ?? 0) >= 60000);
    Promise.all(candidates.map(async dog => {
      try {
        const fix = await fetchLastGpsFix(supabase, masters, dog.id, controller.signal, now);
        if (active) {
          gpsQueryTimes.current.set(dog.id, now);
          if (fix) setHistoricalFixes(old => [...old.filter(row => row.slave_id !== dog.id), fix]);
        }
      } catch (failure) { if (active) setGpsWarning(failure.message); }
    })).finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [owner, rows, masters]);
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
        setMasters(ids);
        setRows(old => old.filter(row => ids.includes(row.master_id)));
        const full = force || !cursor || now - reconciledAt >= 600000 || ids.join(',') !== knownMasters;
        const start = full ? now - DAY : Math.max(now - DAY, cursor - 300000);
        const incoming = await fetchTelemetry({ client: supabase, masterIds: ids, start, end: now,
          signal: controller.signal, newestFirst: true,
          onProgress: count => { if (active) setProgress(count); },
          onPage: page => {
            if (active && !controller.signal.aborted) {
              setRows(old => mergeRows(old.filter(row => ids.includes(row.master_id)), page, now));
            }
          } });
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
  return { rows, masters, historicalFixes: historicalFixes.filter(row => masters.includes(row.master_id)),
    loading, progress, lastSync, error, warning: gpsWarning, refresh };
}

export function usePreferences(owner) {
  const defaultHidden = Array.from({ length: 255 }, (_, i) => i + 1).filter(id => id !== 108);
  const key = `dogtracker-web-preferences:${owner}`;
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key)) ?? {};
      return {
        aliases: saved.aliases && typeof saved.aliases === 'object' ? saved.aliases : {},
        hidden: saved.visibilityVersion === 2 && Array.isArray(saved.hidden) ? saved.hidden.filter(Number.isInteger) : defaultHidden,
        visibilityVersion: 2,
        trails: saved.trails !== false,
        windowMinutes: [3, 10, 30, 60, 360, 1440].includes(saved.windowMinutes) ? saved.windowMinutes : 10,
      };
    } catch { return { aliases: {}, hidden: defaultHidden, visibilityVersion: 2, trails: true, windowMinutes: 10 }; }
  });
  const save = patch => setPreferences(old => {
    const value = { ...old, ...patch };
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences remain usable when storage is unavailable. */ }
    return value;
  });
  return [preferences, save];
}
