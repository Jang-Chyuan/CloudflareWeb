import React, { useEffect, useMemo, useRef, useState } from 'react';
import { activityHistory, dogName, formatTime } from '../tracking/telemetry';
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

export default function DogDetails({ dog, rows, now, aliases, onAlias, onClose, history = false }) {
  const panel = useRef(null);
  const [alias, setAlias] = useState(aliases[dog.id] ?? '');
  const [aliasBusy, setAliasBusy] = useState(false), [aliasError, setAliasError] = useState(''), [aliasSaved, setAliasSaved] = useState(false);
  const aliasDirty = useRef(false);
  useEffect(() => { if (!aliasDirty.current) setAlias(aliases[dog.id] ?? ''); }, [aliases, dog.id]);
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
      <ActivityChart rows={rows} id={dog.id} now={now} />
      <section className="detail-section"><h3>犬隻名稱</h3><form className="alias-form" onSubmit={async e => {
        e.preventDefault(); setAliasBusy(true); setAliasError(''); setAliasSaved(false);
        try { await onAlias(dog.id, alias.trim()); aliasDirty.current = false; setAliasSaved(true); }
        catch (failure) { setAliasError(failure.message); }
        finally { setAliasBusy(false); }
      }}><label>名稱（儲存在 Supabase）<input value={alias} maxLength={20} disabled={aliasBusy} onChange={e => { aliasDirty.current = true; setAlias(e.target.value); setAliasSaved(false); }} placeholder={`狗 ${dog.id}`} /></label><button className="secondary" disabled={aliasBusy}>{aliasBusy ? '儲存中…' : '儲存名稱'}</button></form>
        {aliasError && <p className="error" role="alert">{aliasError}</p>}{aliasSaved && <p role="status">名稱已儲存至 Supabase。</p>}</section>
      <section className="detail-section"><button className="text-button" onClick={() => setRaw(!raw)}>{raw ? '收起' : '查看'}最新封包原始資料</button>{raw && <pre>{JSON.stringify(packet.raw, null, 2)}</pre>}</section>
    </div>
  </section></div>;
}
