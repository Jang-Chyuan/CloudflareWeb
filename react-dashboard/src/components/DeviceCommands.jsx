import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { commandLabel, deviceMode, createDeviceCommand, fetchLatestCommand } from '../tracking/commands';

export default function DeviceCommands() {
  const [command, setCommand] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [online, setOnline] = useState(navigator.onLine);
  const [now, setNow] = useState(Date.now());
  const request = useRef(null), sending = useRef(false), generation = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let controller, reading = false;
    async function refresh() {
      setOnline(navigator.onLine); setNow(Date.now());
      if (!navigator.onLine || document.visibilityState === 'hidden' || reading || sending.current) return;
      const version = generation.current;
      reading = true; controller = new AbortController();
      try {
        const latest = await fetchLatestCommand(supabase, controller.signal);
        if (mounted.current && version === generation.current) { setCommand(latest); setError(previous => previous.startsWith('無法讀取命令狀態') ? '' : previous); }
      } catch (failure) {
        if (mounted.current && failure.name !== 'AbortError') setError('無法讀取命令狀態，請檢查連線及資料表設定。');
      } finally { reading = false; }
    }
    const connectivity = () => { setOnline(navigator.onLine); void refresh(); };
    void refresh();
    const timer = setInterval(refresh, 3000);
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', refresh);
    return () => { mounted.current = false; controller?.abort(); clearInterval(timer);
      window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', refresh); };
  }, []);
  async function send(action) {
    if (sending.current || !navigator.onLine) return;
    // A failed/ambiguous HTTP response keeps the UUID for the same action's retry.
    if (!request.current || request.current.action !== action) request.current = { action, id: crypto.randomUUID() };
    sending.current = true; generation.current++; setBusy(true); setError('');
    try {
      const result = await createDeviceCommand(supabase, action, request.current.id);
      request.current = null;
      if (mounted.current) { setCommand(result); setNow(Date.now()); }
    } catch {
      if (mounted.current) setError('送出未確認。請檢查連線、裝置授權及資料表設定；可按相同命令重試。');
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  const mode = deviceMode(!busy && online && !error ? command : null);
  const confirmedTime = mode.confirmedAt ? new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(mode.confirmedAt)) : null;
  return <section className="device-commands" aria-label="Slave 102 遠端控制">
    <div className="device-mode" role="status" aria-live="polite"><span>裝置模式：</span><strong className={mode.tracking ? 'device-mode-tracking' : ''}>{mode.label}</strong>
      {confirmedTime && <p>確認時間：{confirmedTime}（台灣時間）</p>}</div>
    <h3 className="command-heading">命令操作</h3>
    <div className="command-buttons"><button className="secondary" disabled={busy || !online} onClick={() => send('tracking')}>要求開始追蹤</button>
      <button className="secondary" disabled={busy || !online} onClick={() => send('sleep')}>要求省電待機</button></div>
    <p className={!busy && commandLabel(command, now) === "未收到確認，裝置模式未知" ? "command-unconfirmed" : !busy && command?.status === "confirmed" && command?.action === "tracking" ? "command-confirmed-tracking" : !busy && command?.status === "confirmed" && command?.action === "sleep" ? "command-confirmed-sleep" : undefined} role="status" aria-live="polite">{busy ? '正在送出命令…' : commandLabel(command, now)}</p>
    {!online && <p className="warning">目前離線，連線後才能送出命令。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="command-note">sleep 回到省電待機，仍保留定期回報。追蹤確認不代表 GPS 已定位。</p>
  </section>;
}
