import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { activityHistory, dogName, formatTime } from '../tracking/telemetry';
import { environmentEvidence, environmentLabel } from '../ml/Environment';
import { Metrics } from './DogCard';

function ActivityChart({ rows, id, now }) {
  const values = useMemo(() => activityHistory(rows, id, now), [rows, id, now]);
  const count = values.reduce((sum, value) => sum + value.count, 0);
  return <section className="detail-section"><h3>過去 24 小時活動量</h3><p>每分鐘平均，0 為低活動、1 為高活動；空白區間沒有有效資料。</p>
    <svg className="activity-chart" viewBox="0 0 720 140" role="img" aria-label={`過去 24 小時活動量，共 ${count} 筆有效取樣`}>
      {[0, 0.5, 1].map(value => <g key={value}><line x1="30" x2="715" y1={110 - value * 90} y2={110 - value * 90} stroke="#e6e6e6" /><text x="0" y={114 - value * 90}>{value}</text></g>)}
      {values.map((value, i) => value.value == null ? null : <line key={i} x1={30 + i * 685 / 1440} x2={30 + i * 685 / 1440} y1="110" y2={110 - value.value * 90} stroke="#e85f5c"><title>{formatTime(value.time)} · {value.value.toFixed(3)} · {value.count} 筆</title></line>)}
      <text x="30" y="136">24 小時前</text><text x="350" y="136">12 小時前</text><text x="680" y="136">現在</text>
    </svg><p>{count ? `${count.toLocaleString()} 筆有效取樣` : '目前沒有有效活動資料。'}</p>
  </section>;
}

function FixedLocation({ dog, location, owner, onSaved }) {
  const [editing, setEditing] = useState(false), [password, setPassword] = useState('');
  const [unlock, setUnlock] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState(location?.name ?? ''), [latitude, setLatitude] = useState(location?.latitude ?? '');
  const [longitude, setLongitude] = useState(location?.longitude ?? ''), [enabled, setEnabled] = useState(location?.enabled ?? true);
  const active = useRef(true);
  useEffect(() => {
    if (editing) return;
    setName(location?.name ?? ''); setLatitude(location?.latitude ?? '');
    setLongitude(location?.longitude ?? ''); setEnabled(location?.enabled ?? true);
  }, [location, editing]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!unlock) return;
    const timeout = setTimeout(() => { setUnlock(null); setEditing(false); setError('解鎖已逾時，請重新輸入密碼。'); }, Math.max(0, unlock.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [unlock]);
  useEffect(() => {
    const lock = () => { if (document.visibilityState === 'hidden') { setUnlock(null); setEditing(false); setPassword(''); } };
    document.addEventListener('visibilitychange', lock);
    return () => document.removeEventListener('visibilitychange', lock);
  }, []);
  async function authorize(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || auth.user?.id !== owner) throw new Error('請重新登入。');
      const { data, error: failure } = await supabase.functions.invoke('unlock-fixed-location', {
        body: { slave_id: dog.id, master_id: location?.master_id ?? dog.masterId, password },
      });
      if (failure || !data?.token || !Number.isFinite(data.expiresAt)) throw new Error('無法解鎖，請確認帳號密碼、網路與固定位置設定權限。');
      if (active.current && document.visibilityState === 'visible') setUnlock(data);
    } catch (failure) { if (active.current) setError(failure.message); }
    finally { if (active.current) { setPassword(''); setBusy(false); } }
  }
  async function save(event) {
    event.preventDefault(); setError('');
    const lat = Number(latitude), lon = Number(longitude);
    if (!name.trim() || !String(latitude).trim() || !String(longitude).trim() || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      setError('請輸入位置名稱及有效的經緯度。'); return;
    }
    if (!unlock || unlock.expiresAt <= Date.now()) { setUnlock(null); setError('請重新輸入密碼解鎖。'); return; }
    setBusy(true);
    try {
      const { error: failure } = await supabase.rpc('save_unlocked_fixed_location', {
        p_token: unlock.token, p_slave_id: dog.id, p_master_id: location?.master_id ?? dog.masterId,
        p_name: name.trim(), p_latitude: lat, p_longitude: lon, p_enabled: enabled,
      });
      if (failure) throw new Error('儲存失敗，請重新解鎖；可重新整理確認是否已儲存。');
      if (active.current) { setEditing(false); onSaved(); }
    } catch (failure) { if (active.current) setError(failure.message); }
    finally { if (active.current) { setUnlock(null); setBusy(false); } }
  }
  return <section className="detail-section"><h3>固定位置設定</h3>
    {!editing ? <><p>{location ? `${location.name} · ${location.enabled ? '已啟用' : '未啟用'}` : '尚未設定固定位置。'}</p>
      {location && <p>{location.latitude}, {location.longitude}</p>}
      <p>USB 充電或近期判斷為室內／窗邊時，使用已設定的位置。</p>
      <button className="secondary" onClick={() => { setEditing(true); setError(''); }}>修改設定</button></>
      : !unlock ? <form onSubmit={authorize}><p>輸入目前帳號密碼，驗證後可修改此犬隻的設定。</p>
        <label>帳號密碼<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} /></label>
        <div className="form-actions"><button className="primary" disabled={busy}>{busy ? '驗證中…' : '解鎖'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setPassword(''); }}>取消</button></div></form>
      : <form onSubmit={save}><label>位置名稱<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required disabled={busy} /></label>
        <div className="form-grid"><label>緯度<input type="number" step="any" min="-90" max="90" value={latitude} onChange={e => setLatitude(e.target.value)} required disabled={busy} /></label>
          <label>經度<input type="number" step="any" min="-180" max="180" value={longitude} onChange={e => setLongitude(e.target.value)} required disabled={busy} /></label></div>
        <label className="check-label"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={busy} />啟用固定位置</label>
        <div className="form-actions"><button className="primary" disabled={busy}>{busy ? '儲存中…' : '儲存'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setUnlock(null); setEditing(false); }}>取消</button></div></form>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}

export default function DogDetails({ dog, rows, now, aliases, onAlias, onClose, fixedLocations, owner, onRefresh, history = false }) {
  const panel = useRef(null);
  const [alias, setAlias] = useState(aliases[dog.id] ?? '');
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    function key(event) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const controls = [...panel.current.querySelectorAll('button,input,select,a[href]')].filter(el => !el.disabled);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  const packet = dog.packet;
  return <div className="modal-backdrop" onClick={onClose}><section className="detail-modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dog-detail-title" onClick={e => e.stopPropagation()}>
    <header className="detail-header"><div><span className="eyebrow">SLAVE {dog.id}</span><h2 id="dog-detail-title">{dogName(dog.id, aliases)}</h2></div><button className="icon-button" aria-label="關閉詳細資訊" onClick={onClose}>×</button></header>
    <div className="detail-body"><p>來源：經 Master {dog.masterId} · 雲端</p><p className={dog.stale ? 'warning' : ''}>{dog.status}{dog.retained ? ' · 最後有效位置，非最新定位' : ''}</p><Metrics dog={dog} />
      <dl className="detail-grid"><div><dt>最後封包</dt><dd>{formatTime(dog.lastPacketAt)}</dd></div><div><dt>有效定位</dt><dd>{formatTime(dog.lastPositionAt)}</dd></div>
        <div><dt>衛星</dt><dd>{packet.satellites ?? '—'}</dd></div><div><dt>HDOP</dt><dd>{packet.hdop ?? '—'}</dd></div>
        <div><dt>RSSI</dt><dd>{packet.rssi == null ? '—' : `${packet.rssi} dBm`}</dd></div><div><dt>SNR</dt><dd>{packet.snr == null ? '—' : `${packet.snr} dB`}</dd></div>
        <div><dt>USB</dt><dd>{packet.usb_present === 1 ? '已連接' : packet.usb_present === 0 ? '未連接' : '未知'}</dd></div><div><dt>活動量</dt><dd>{packet.activity_valid && packet.activity != null ? packet.activity.toFixed(3) : '尚無有效資料'}</dd></div></dl>
      <section className="detail-section"><h3>目前環境</h3><p>{environmentLabel(dog.environment, now)}</p>{dog.environment && <><p>{environmentEvidence(dog.environment)}</p><p>判斷區間：{formatTime(dog.environment.windowStart)} 至 {formatTime(dog.environment.windowEnd)} · {dog.environment.samples} 筆取樣</p></>}</section>
      <ActivityChart rows={rows} id={dog.id} now={now} />
      {!history && <FixedLocation dog={dog} owner={owner} location={fixedLocations.find(row => row.slave_id === dog.id)} onSaved={onRefresh} />}
      <section className="detail-section"><h3>犬隻名稱</h3><form className="alias-form" onSubmit={e => { e.preventDefault(); onAlias(dog.id, alias.trim()); }}><label>名稱（儲存在此瀏覽器）<input value={alias} maxLength={20} onChange={e => setAlias(e.target.value)} placeholder={`狗 ${dog.id}`} /></label><button className="secondary">儲存名稱</button></form></section>
      <section className="detail-section"><button className="text-button" onClick={() => setRaw(!raw)}>{raw ? '收起' : '查看'}最新封包原始資料</button>{raw && <pre>{JSON.stringify(packet.raw, null, 2)}</pre>}</section>
    </div>
  </section></div>;
}
