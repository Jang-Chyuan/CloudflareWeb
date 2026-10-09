import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { dateRange, fetchTelemetry } from '../tracking/cloud';
import { buildRoutes, coordinate, dogName, formatTime } from '../tracking/telemetry';
import TrackingMap from './TrackingMap';

export default function History({ masters, aliases, hidden, onDetails }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
  const [startDate, setStartDate] = useState(today), [endDate, setEndDate] = useState(today);
  const [master, setMaster] = useState(''), [slave, setSlave] = useState('');
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [page, setPage] = useState(0);
  const [playhead, setPlayhead] = useState(null), [playing, setPlaying] = useState(false);
  const [rawId, setRawId] = useState(null);
  const request = useRef(null), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  const availableIds = [...new Set(rows.map(row => row.slave_id))].sort((a, b) => a - b);
  const filtered = useMemo(() => rows.filter(row => !slave || row.slave_id === Number(slave)).sort((a, b) => a.track_at - b.track_at || a.id.localeCompare(b.id)), [rows, slave]);
  const first = filtered[0]?.track_at ?? 0, last = filtered.at(-1)?.track_at ?? 0;
  const visibleTime = playhead == null ? last : Math.min(last, Math.max(first, playhead));
  const routes = useMemo(() => buildRoutes(filtered, first, visibleTime), [filtered, first, visibleTime]);
  const dogs = useMemo(() => {
    const latest = new Map();
    for (const row of filtered) {
      if (row.track_at > visibleTime) break;
      const position = coordinate(row.slave_lat, row.slave_lon);
      if (position) latest.set(row.slave_id, { id: row.slave_id, position, stale: false });
    }
    return [...latest.values()];
  }, [filtered, visibleTime]);
  useEffect(() => {
    if (!playing || !last || first === last) return;
    const interval = setInterval(() => setPlayhead(old => {
      const next = (old ?? first) + Math.max(1000, (last - first) / 120);
      if (next >= last) { setPlaying(false); return last; }
      return next;
    }), 250);
    return () => clearInterval(interval);
  }, [playing, first, last]);
  useEffect(() => { setPage(0); setPlayhead(null); setPlaying(false); }, [slave, rows]);
  // Revoked Master access must also remove already displayed historical data.
  useEffect(() => {
    const allowed = new Set(masters);
    setRows(old => old.filter(row => allowed.has(row.master_id)));
  }, [masters.join(',')]);
  async function load(event) {
    event.preventDefault(); if (loading) return;
    setError(''); setPlaying(false);
    let range;
    try { range = dateRange(startDate, endDate); } catch (failure) { setError(failure.message); return; }
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120000);
    setLoading(true); setProgress(0);
    try {
      const result = await fetchTelemetry({ client: supabase, masterIds: master ? [Number(master)].filter(id => masters.includes(id)) : masters,
        ...range, signal: controller.signal, onProgress: count => { if (active.current) setProgress(count); } });
      if (active.current && !controller.signal.aborted) { setRows(result); setLoaded(true); setSlave(''); }
    } catch (failure) { if (active.current) setError(controller.signal.aborted ? '查詢已取消或逾時，請縮小範圍後重試。' : failure.message); }
    finally { clearTimeout(timeout); if (active.current) setLoading(false); }
  }
  function download() {
    const fields = ['slave_id', 'master_id', 'time_taipei', 'latitude', 'longitude', 'speed_kmh', 'battery_percentage', 'activity'];
    const text = [fields.join(','), ...filtered.map(row => [row.slave_id, row.master_id, formatTime(row.track_at), row.slave_lat, row.slave_lon, row.speed_kmh, row.battery_valid ? row.battery_percentage : '', row.activity_valid ? row.activity : ''].join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `DogTracker-${startDate}-${endDate}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function inspect(id) {
    const samples = filtered.filter(row => row.slave_id === id && row.track_at <= visibleTime);
    const packet = samples.at(-1);
    const fix = [...samples].reverse().find(row => coordinate(row.slave_lat, row.slave_lon));
    if (!packet) return;
    onDetails({ history: true, now: visibleTime, rows: filtered, dog: {
      id, packet, masterId: packet.master_id, status: '歷史紀錄', environment: null,
      lastPacketAt: packet.track_at, lastPositionAt: fix?.track_at ?? null,
      position: fix ? coordinate(fix.slave_lat, fix.slave_lon) : null,
      retained: fix?.id !== packet.id, stale: false,
      speed: coordinate(packet.slave_lat, packet.slave_lon) ? packet.speed_kmh : null,
      battery: packet.battery_valid ? packet.battery_percentage : null,
    } });
  }
  const ordered = [...filtered].reverse();
  const pages = Math.max(1, Math.ceil(ordered.length / 50));
  return <section className="history-page"><div className="section-heading"><div><span className="eyebrow">HISTORY</span><h1>歷史軌跡</h1><p>以台灣時間查詢，每次最多 7 天。</p></div><button className="secondary" disabled={!filtered.length || loading} onClick={download}>匯出 CSV ↓</button></div>
    <form className="history-filters" onSubmit={load}><label>開始日期<input type="date" value={startDate} max={today} onChange={e => setStartDate(e.target.value)} required disabled={loading} /></label>
      <label>結束日期<input type="date" value={endDate} min={startDate} max={today} onChange={e => setEndDate(e.target.value)} required disabled={loading} /></label>
      <label>Master<select value={master} onChange={e => setMaster(e.target.value)} disabled={loading}><option value="">全部 Master</option>{masters.map(id => <option key={id} value={id}>Master {id}</option>)}</select></label>
      <button className="primary" disabled={loading || !masters.length}>{loading ? `讀取 ${progress.toLocaleString()} 筆…` : '查詢軌跡'}</button>{loading && <button type="button" className="secondary" onClick={() => request.current?.abort()}>取消</button>}
    </form>{error && <p role="alert" className="error banner">{error}</p>}
    {!loaded ? <div className="empty-state"><span>↝</span><h2>選擇日期，查看走過的路線</h2><p>{masters.length ? '資料只包含此帳號授權的 Master 與 Slave。' : '目前沒有 Master 授權，請聯絡管理員。'}</p></div>
      : !rows.length ? <div className="empty-state"><h2>這段期間沒有資料</h2><p>請選擇其他日期或 Master。</p></div> : <>
        <div className="history-tools"><label>犬隻<select value={slave} onChange={e => setSlave(e.target.value)}><option value="">全部犬隻</option>{availableIds.map(id => <option key={id} value={id}>{dogName(id, aliases)}</option>)}</select></label><span>{filtered.length.toLocaleString()} 筆資料 · {availableIds.length} 隻狗</span></div>
        <TrackingMap dogs={dogs} routes={routes} hidden={hidden} focus={null} aliases={aliases} showTrails onDetails={inspect} viewKey={`history:${first}:${last}:${slave}`} />
        <div className="playback"><button className="secondary" disabled={first === last} onClick={() => { if (visibleTime >= last) setPlayhead(first); setPlaying(!playing); }}>{playing ? '暫停' : '播放'}</button>
          <input type="range" aria-label="歷史回放時間" min={first} max={last || 1} step={1000} value={visibleTime} disabled={first === last} onChange={e => { setPlaying(false); setPlayhead(Number(e.target.value)); }} /><time>{formatTime(visibleTime)}</time></div>
        <div className="history-table-wrap"><table><thead><tr><th>犬隻</th><th>Master</th><th>時間（台灣）</th><th>緯度</th><th>經度</th><th>速度 km/h</th><th>電量</th><th>活動量</th><th>封包</th></tr></thead><tbody>
          {ordered.slice(page * 50, page * 50 + 50).map(row => <React.Fragment key={row.id}><tr><td>{dogName(row.slave_id, aliases)}</td><td>{row.master_id}</td><td>{formatTime(row.track_at)}</td><td>{row.slave_lat?.toFixed(6) ?? '—'}</td><td>{row.slave_lon?.toFixed(6) ?? '—'}</td><td>{row.speed_kmh ?? '—'}</td><td>{row.battery_valid ? `${row.battery_percentage ?? '—'}%` : '—'}</td><td>{row.activity_valid ? row.activity?.toFixed(3) ?? '—' : '—'}</td><td><button className="text-button" aria-expanded={rawId === row.id} onClick={() => setRawId(rawId === row.id ? null : row.id)}>{rawId === row.id ? '收起' : '查看'}</button></td></tr>
            {rawId === row.id && <tr><td colSpan={9}><pre>{JSON.stringify(row.raw, null, 2)}</pre></td></tr>}</React.Fragment>)}
        </tbody></table></div><div className="pagination"><span>第 {page + 1} / {pages} 頁</span><button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>上一頁</button><button className="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一頁</button></div>
      </>}
  </section>;
}
