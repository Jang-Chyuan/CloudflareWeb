import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { commandLabel, deviceMode, createDeviceCommand, fetchLatestCommand, pendingCommand, controlMasters } from '../tracking/commands';

const isWaiting = (command, now) => pendingCommand(command) &&
  (!Number.isFinite(Date.parse(command.expires_at)) || Date.parse(command.expires_at) > now);
const isFailed = (command, now) => command && (['unconfirmed', 'expired', 'rejected'].includes(command.status) ||
  (pendingCommand(command) && !isWaiting(command, now)));

export default function DeviceCommands({ slaveId = 102, authorizedMasters = [] }) {
  const allowed = controlMasters(authorizedMasters), allowedKey = allowed.join(',');
  const [choice, setChoice] = useState(String(allowed[0] ?? 5));
  const selected = choice === 'both' && allowed.length === 2 ? 'both' :
    allowed.includes(Number(choice)) ? choice : String(allowed[0]);
  const targets = selected === 'both' ? allowed : allowed.filter(id => id === Number(selected));
  const [channels, setChannels] = useState({}), [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine), [now, setNow] = useState(Date.now());
  const requests = useRef({}), sending = useRef(false), generation = useRef(0), mounted = useRef(false);
  const update = (id, patch) => setChannels(old => ({...old, [id]: {...old[id], ...patch}}));
  useEffect(() => {
    mounted.current = true;
    let controller, reading = false, active = true;
    async function refresh() {
      setOnline(navigator.onLine); setNow(Date.now());
      if (!navigator.onLine || document.visibilityState === 'hidden' || reading || sending.current) return;
      const version = generation.current;
      reading = true; controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        await Promise.all(allowed.map(async id => {
          try {
            const command = await fetchLatestCommand(supabase, controller.signal, id, slaveId);
            if (!active || version !== generation.current) return;
            if (requests.current[id] && command?.request_id === requests.current[id].id) {
              delete requests.current[id];
              update(id, {command, ready:true, retryAction:null, error:''});
            } else setChannels(old => ({...old, [id]: {...old[id], command, ready:true,
              error:old[id]?.retryAction ? old[id].error : ''}}));
          } catch (error) {
            if (active && version === generation.current)
              update(id, {ready:false, error:'無法讀取命令狀態，請檢查連線及資料表設定。'});
          }
        }));
      } finally { clearTimeout(timeout); reading = false; }
    }
    void refresh();
    const timer = setInterval(refresh, 3000);
    const connectivity = () => { setOnline(navigator.onLine); void refresh(); };
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; mounted.current = false; controller?.abort(); clearInterval(timer);
      window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', refresh); };
  }, [slaveId, allowedKey]);
  // Block conflicting actions while either authorized channel is still in flight.
  const waiting = allowed.some(id => isWaiting(channels[id]?.command, now));
  const ambiguous = allowed.some(id => channels[id]?.retryAction);
  const ready = targets.length > 0 && targets.every(id => channels[id]?.ready);
  async function send(action, retryIds = null) {
    if (sending.current || !navigator.onLine || waiting || (!retryIds && (!ready || ambiguous))) return;
    const ids = retryIds ?? targets;
    if (!ids.length || ids.some(id => !allowed.includes(id))) return;
    sending.current = true; generation.current++; setBusy(true);
    // Each Master needs a distinct UUID because the database keys retries by user/UUID.
    for (const id of ids) {
      if (!requests.current[id] || requests.current[id].action !== action)
        requests.current[id] = {action, id:crypto.randomUUID()};
      update(id, {error:''});
    }
    await Promise.all(ids.map(async id => {
      try {
        const result = await createDeviceCommand(supabase, action, requests.current[id].id, slaveId, id);
        delete requests.current[id];
        if (mounted.current) update(id, {command:result, ready:true, retryAction:null, error:''});
      } catch {
        if (mounted.current) update(id, {retryAction:action,
          error:'送出未確認。請檢查連線、裝置授權及資料表設定；可按「重試」查詢或重送同一請求。'});
      }
    }));
    sending.current = false;
    if (mounted.current) { setBusy(false); setNow(Date.now()); }
  }
  if (!allowed.length) return null;
  return <section className="device-commands" aria-label={`Slave ${slaveId} 遠端控制`}>
    <label>發送 Master<select aria-label="發送 Master" value={selected}
      disabled={busy || waiting || ambiguous} onChange={e => setChoice(e.target.value)}>
      <option value="5" disabled={!allowed.includes(5)}>Master5{!allowed.includes(5) ? '（未授權）' : ''}</option>
      <option value="201" disabled={!allowed.includes(201)}>Master201{!allowed.includes(201) ? '（未授權）' : ''}</option>
      <option value="both" disabled={allowed.length !== 2}>兩台同送{allowed.length !== 2 ? '（需兩台授權）' : ''}</option>
    </select></label>
    <p className="command-note">控制通道：{targets.map(id => `Master ${id}`).join('、')} → Slave {slaveId}</p>
    <h3 className="command-heading">命令操作</h3>
    <div className="command-buttons"><button className="secondary" disabled={busy || !online || waiting || !ready || ambiguous} onClick={() => send('tracking')}>要求開始追蹤</button>
      <button className="secondary" disabled={busy || !online || waiting || !ready || ambiguous} onClick={() => send('sleep')}>要求省電待機</button></div>
    {waiting && <p className="command-note">等待裝置確認，暫停其他命令操作。</p>}
    {targets.map(id => {
      const channel = channels[id] ?? {}, command = channel.command;
      const mode = deviceMode(!busy && online && !channel.error ? command : null);
      const retry = channel.retryAction || (isFailed(command, now) ? command.action : null);
      const label = commandLabel(command, now);
      return <section key={id} aria-label={`Master ${id} 命令結果`}>
        {targets.length > 1 && <h4>Master {id}</h4>}
        <div className="device-mode" role="status" aria-live="polite"><span>裝置模式：</span><strong className={mode.tracking ? 'device-mode-tracking' : ''}>{mode.label}</strong>
          {mode.confirmedAt && <p>確認時間：{new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}).format(new Date(mode.confirmedAt))}（台灣時間）</p>}</div>
        <p role="status" aria-live="polite" className={label === '未收到確認，裝置模式未知' ? 'command-unconfirmed' :
          command?.status === 'confirmed' ? command.action === 'tracking' ? 'command-confirmed-tracking' : 'command-confirmed-sleep' : undefined}>{busy ? '正在送出命令…' : label}</p>
        {retry && !waiting && <button className="secondary" disabled={busy || !online || (!channel.ready && !channel.retryAction)} onClick={() => send(retry, [id])}>重試{retry === 'tracking' ? '追蹤' : '省電待機'}命令{targets.length > 1 ? `（Master ${id}）` : ''}</button>}
        {channel.error && <p className="error" role="alert">{channel.error}</p>}
      </section>;
    })}
    {!online && <p className="warning">目前離線，連線後才能送出命令。</p>}
    {targets.length > 1 && <p className="command-note">兩台分別送出相同動作，確認結果分開顯示；一台確認不代表另一台也已確認。</p>}
    <p className="command-note">sleep 回到省電待機，仍保留定期回報。追蹤確認不代表 GPS 已定位。</p>
  </section>;
}
