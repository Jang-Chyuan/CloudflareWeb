import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabaseClient';
import { useAuth, useCloudTracking, usePreferences } from './hooks/useCloudTracking';
import { buildDogs, buildRoutes } from './tracking/telemetry';
import Login from './components/Login';
import TrackingMap from './components/TrackingMap';
import DogCard from './components/DogCard';
import DogDetails from './components/DogDetails';
import History from './components/History';

class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <div className="empty-state"><h1>畫面載入失敗</h1><p>請重新整理頁面，再試一次。</p><button className="primary" onClick={() => window.location.reload()}>重新整理</button></div> : this.props.children;
  }
}

function Dashboard({ session }) {
  const cloud = useCloudTracking(session.user.id);
  const [preferences, save] = usePreferences(session.user.id);
  const [tab, setTab] = useState('live'), [focus, setFocus] = useState(null), [details, setDetails] = useState(null);
  const [now, setNow] = useState(Date.now()), [signingOut, setSigningOut] = useState(false), [authError, setAuthError] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  const dogs = useMemo(() => buildDogs(cloud.rows, cloud.fixedLocations, now), [cloud.rows, cloud.fixedLocations, now]);
  const routes = useMemo(() => buildRoutes(cloud.rows, now - preferences.windowMinutes * 60000, now), [cloud.rows, preferences.windowMinutes, now]);
  const filtered = dogs.filter(dog => `${preferences.aliases[dog.id] ?? ''} ${dog.id} Master ${dog.masterId}`.toLowerCase().includes(search.toLowerCase()));
  const selectedDog = details?.history ? details.dog : dogs.find(dog => dog.id === details?.id);
  const closeDetails = useCallback(() => setDetails(null), []);
  function toggleDog(id) {
    save({ hidden: preferences.hidden.includes(id) ? preferences.hidden.filter(value => value !== id) : [...preferences.hidden, id] });
    if (focus === id) setFocus(null);
  }
  async function logout() {
    setSigningOut(true); setAuthError(''); setDetails(null);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) setAuthError('登出失敗，請稍後再試。');
    } catch { setAuthError('登出失敗，請稍後再試。'); }
    finally { setSigningOut(false); }
  }
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('live'); }}><span className="brand-paw">🐾</span> DogWebTracker <span className="web-badge">WEB</span></a>
      <nav aria-label="主要導覽"><button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>◎ 即時追蹤</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>↝ 歷史軌跡</button></nav>
      <div className="account"><span title={session.user.email}>{session.user.email}</span><button className="secondary" disabled={signingOut} onClick={logout}>{signingOut ? '登出中…' : '登出'}</button></div>
    </header>
    {(cloud.error || authError) && <div className="error banner" role="alert">{cloud.error || authError}<button className="text-button" disabled={cloud.loading} onClick={cloud.refresh}>重新讀取</button></div>}
    {cloud.warning && <div className="warning banner" role="status">{cloud.warning}</div>}
    <main className="dashboard-main">
      {tab === 'live' ? <>
        <div className="tracking-layout"><section className="tracking-map-area">
          <div className="map-toolbar"><div className="map-title"><span className="online-dot" /> Slave 地圖</div><div className="map-options">
            <label className="check-label"><input type="checkbox" checked={preferences.trails} onChange={e => save({ trails: e.target.checked })} />移動路徑</label>
            <label className="sr-only" htmlFor="route-window">路徑時間範圍</label><select id="route-window" value={preferences.windowMinutes} onChange={e => save({ windowMinutes: Number(e.target.value) })}>
              {[3, 10, 30, 60, 360, 1440].map(minutes => <option key={minutes} value={minutes}>過去 {minutes < 60 ? `${minutes} 分鐘` : `${minutes / 60} 小時`}</option>)}</select>
            <button className="text-button" onClick={() => { setFocus(null); save({ hidden: [] }); }}>顯示全部</button>
          </div></div>
          <TrackingMap dogs={dogs} routes={routes} hidden={preferences.hidden} focus={focus} aliases={preferences.aliases} showTrails={preferences.trails} onDetails={id => setDetails({ id })} viewKey="live" syncing={cloud.loading} />
          <div className="map-footer"><span>🐕 點選犬隻圖示查看詳細資訊</span><span>位置超過 3 分鐘未更新即隱藏</span></div>
        </section><aside className="dog-list">
          <div className="dog-list-heading"><h2>犬隻 <span>{dogs.length}</span></h2><span>最近 24 小時</span></div>
          <label className="sr-only" htmlFor="dog-search">搜尋犬隻或 Master</label><input id="dog-search" className="dog-search" type="search" placeholder="搜尋犬隻或 Master…" value={search} onChange={e => setSearch(e.target.value)} />
          {!dogs.length && <div className="empty-state"><span>🐾</span><h3>{cloud.loading ? '正在讀取犬隻資料…' : cloud.lastSync && !cloud.masters.length ? '尚無 Master 授權' : '目前沒有犬隻資料'}</h3><p>{cloud.lastSync && !cloud.masters.length ? '請聯絡管理員授權此帳號。' : '等待 Master 上傳最近 24 小時的 Slave 封包。'}</p></div>}
          {!!dogs.length && !filtered.length && <p className="empty-search">找不到符合條件的犬隻。</p>}
          <div className="dog-list-scroll">{filtered.map(dog => <DogCard key={dog.id} dog={dog} now={now} aliases={preferences.aliases} hidden={preferences.hidden.includes(dog.id)} following={focus === dog.id}
            onFollow={() => setFocus(focus === dog.id ? null : dog.id)} onToggle={() => toggleDog(dog.id)} onDetails={() => setDetails({ id: dog.id })} />)}</div>
        </aside></div>
      </> : <History masters={cloud.masters} aliases={preferences.aliases} hidden={preferences.hidden} onDetails={setDetails} />}
      <footer className="app-footer"><span>DogWebTracker · Slave 追蹤</span><span>時間均為台灣時間（UTC+8）</span></footer>
    </main>
    {selectedDog && <DogDetails key={`${selectedDog.id}:${details?.history ? 'history' : 'live'}`} dog={selectedDog} rows={details?.history ? details.rows : cloud.rows} now={details?.history ? details.now : now} history={!!details?.history}
      aliases={preferences.aliases} onAlias={(id, alias) => save({ aliases: { ...preferences.aliases, [id]: alias } })} onClose={closeDetails}
      fixedLocations={cloud.fixedLocations} owner={session.user.id} onRefresh={cloud.refreshFixed} />}
  </div>;
}

export default function App() {
  const auth = useAuth();
  return <ErrorBoundary>{!auth.ready ? <div className="empty-state"><h1>DogWebTracker</h1><p>正在恢復登入…</p></div>
    : auth.session ? <Dashboard key={auth.session.user.id} session={auth.session} /> : <Login authError={auth.error} />}</ErrorBoundary>;
}
