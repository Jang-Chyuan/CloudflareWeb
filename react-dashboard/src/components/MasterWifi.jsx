import React, { useEffect, useRef, useState } from 'react';
import { MasterWifiClient, wifiSupport, wifiMessage } from '../wifi/masterWifi';

export default function MasterWifi({ onClose }) {
  const dialog = useRef(null), client = useRef(null), alive = useRef(true), pendingSetting = useRef(null);
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [networks, setNetworks] = useState(null), [checkedAt, setCheckedAt] = useState(null);
  const [nearby, setNearby] = useState(null), [scanAt, setScanAt] = useState(null);
  const [ssid, setSsid] = useState(''), [password, setPassword] = useState(''), [openNetwork, setOpenNetwork] = useState(false), [showPassword, setShowPassword] = useState(false), [removeSsid, setRemoveSsid] = useState(null);
  const unsupported = wifiSupport();
  if (!client.current) client.current = new MasterWifiClient({ onDisconnect: () => {
    if (!alive.current) return;
    pendingSetting.current = null; setName(''); setNetworks(null); setNearby(null); setScanAt(null); setPassword(''); setRemoveSsid(null); setNotice(''); setError('Master 已斷線，請重新連線。');
  } });
  useEffect(() => {
    alive.current = true; dialog.current.showModal();
    const previous = document.activeElement;
    return () => { alive.current = false; client.current.disconnect(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!name || busy) return;
    let stopped = false, inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try { await refresh(() => !stopped); }
      catch (e) { if (!stopped && alive.current) setError(wifiMessage(e)); }
      finally { inFlight = false; }
    }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [name, busy]);
  async function perform(operation) {
    setBusy(true); setError('');
    try { await operation(); } catch (e) { if (alive.current) { setNotice(''); setError(wifiMessage(e)); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function refresh(isCurrent = () => true) {
    const data = await client.current.list();
    if (alive.current && isCurrent()) {
      setNetworks(data); setCheckedAt(new Date());
      const pending = pendingSetting.current;
      if (pending && data.ssids.includes(pending)) {
        setNotice(data.active === pending
          ? `已確認儲存「${pending}」；Master 目前連線：${pending}。`
          : `已確認儲存「${pending}」；Master 目前連線：${data.active || '尚未連線'}。若已更新 Master 韌體，會優先連線到此次設定的網路；連線失敗時使用備援網路。`);
        pendingSetting.current = null;
      }
    }
  }
  function connect() {
    setNotice(''); setNetworks(null); setNearby(null); setScanAt(null); setName(''); setPassword('');
    // perform invokes this synchronously through the chooser's user gesture.
    perform(async () => { const connected = await client.current.connect(); if (!alive.current) return; setName(connected); await refresh(); });
  }
  function disconnect() {
    client.current.disconnect(); pendingSetting.current = null; setName(''); setNetworks(null); setNearby(null); setScanAt(null); setPassword(''); setRemoveSsid(null); setNotice('已中斷與 Master 的藍牙連線。'); setError('');
  }
  function scan() {
    setNearby(null); setScanAt(null); setNotice('Master 正在掃描附近 Wi-Fi，請保持藍牙連線。');
    perform(async () => {
      const result = await client.current.scan();
      if (alive.current) { setNearby(result); setScanAt(new Date()); setNotice('掃描完成，點選網路名稱可帶入設定。'); }
    });
  }
  function selectNearby(ap) {
    setSsid(ap.ssid); setPassword(''); setOpenNetwork(!ap.secure); setRemoveSsid(null);
  }
  function submit(event) {
    event.preventDefault();
    perform(async () => {
      const reply = await client.current.upsert(ssid, openNetwork ? '' : password);
      if (reply.status !== 'accepted') throw new Error('Unexpected receipt');
      if (alive.current) { pendingSetting.current = ssid; setPassword(''); setNotice('Master 已受理 Wi-Fi 設定；正在自動確認儲存與連線狀態。'); await refresh(); }
    });
  }
  function remove() {
    const target = removeSsid;
    perform(async () => { const reply = await client.current.remove(target);
      if (reply.status !== 'accepted') throw new Error('Unexpected receipt');
      if (alive.current) { setRemoveSsid(null); setNotice('Master 已受理刪除要求；請稍後重新整理確認。'); }
    });
  }
  return <dialog ref={dialog} className="master-wifi" aria-labelledby="master-wifi-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="master-wifi-title">Master Wi-Fi 設定</h2><button type="button" className="icon-button" aria-label="關閉 Wi-Fi 設定" onClick={onClose}>×</button></header>
    <div className="master-wifi-body">
      <p>靠近 Master，透過本機藍牙設定 Wi-Fi。帳密只傳送給選取的裝置，不上傳雲端或儲存在瀏覽器。</p>
      {unsupported ? <p role="status" className="warning">{unsupported}</p> : <>
        <div className="wifi-actions"><button type="button" className="primary" disabled={busy || !!name} onClick={connect}>{busy && !name ? '連線中…' : '選擇並連線 Master'}</button>
          {name && <button type="button" className="secondary" disabled={busy} onClick={disconnect}>中斷連線</button>}</div>
        <p className="wifi-connection" role="status">{name ? `藍牙已連線：${name}` : '尚未連線 Master'}</p>
        {name && <>
          <section aria-label="Master Wi-Fi 狀態"><h3>目前連線與已儲存網路</h3>
            <p>Master Wi-Fi：<strong>{networks ? networks.active || '目前未連線' : '尚未讀取'}</strong></p>
            {checkedAt && <p className="wifi-muted">最後查詢：{checkedAt.toLocaleTimeString('zh-TW')}</p>}
            <button className="secondary" type="button" disabled={busy} onClick={() => perform(() => refresh())}>重新整理 Wi-Fi 清單</button>
            {networks && (!networks.ssids.length ? <p>Master 尚未儲存網路。</p> : <ul className="wifi-networks">{networks.ssids.map(network => <li key={network}>
              <button className="wifi-ssid" type="button" disabled={busy} onClick={() => { setSsid(network); setPassword(''); setOpenNetwork(false); setRemoveSsid(null); }}>{network}{network === networks.active && <small>目前連線</small>}</button>
              <button type="button" className="secondary" disabled={busy} aria-label={`刪除 ${network}`} onClick={() => setRemoveSsid(network)}>刪除</button>
            </li>)}</ul>)}
            {removeSsid !== null && <div className="wifi-remove" role="group" aria-label="確認刪除網路"><p>確定刪除「{removeSsid}」？若是目前使用的網路，Master 會重新選擇連線。</p>
              <button type="button" className="secondary" disabled={busy} onClick={remove}>確認刪除網路</button><button type="button" className="text-button" disabled={busy} onClick={() => setRemoveSsid(null)}>取消刪除</button></div>}
          </section>
          <section aria-label="附近 Wi-Fi"><h3>掃描附近 Wi-Fi</h3>
            <p className="wifi-muted">由 Master 掃描附近的網路；隱藏的 SSID 可在下方手動輸入。</p>
            <button type="button" className="secondary" disabled={busy} onClick={scan}>掃描附近 Wi-Fi</button>
            {scanAt && <p className="wifi-muted">掃描時間：{scanAt.toLocaleTimeString('zh-TW')}</p>}
            {nearby && (!nearby.networks.length ? <p>未找到可用的 Wi-Fi，請靠近路由器或手動輸入 SSID。</p> : <ul className="wifi-networks">{nearby.networks.map(ap => <li key={ap.ssid}>
              <button type="button" className="wifi-ssid" disabled={busy} onClick={() => selectNearby(ap)}>{ap.ssid}<small>{ap.secure ? '需要密碼' : '開放網路'} · {ap.rssi} dBm</small></button>
            </li>)}</ul>)}
            {nearby?.truncated && <p className="wifi-muted">網路較多，僅顯示訊號最強的 20 個 SSID。</p>}
          </section>
          <form onSubmit={submit}><h3>新增或更新網路</h3><label htmlFor="wifi-ssid">Wi-Fi 名稱（SSID）</label><input id="wifi-ssid" value={ssid} onChange={e => setSsid(e.target.value)} disabled={busy} required autoComplete="off" autoCapitalize="none" spellCheck={false} />
            <label htmlFor="wifi-password">Wi-Fi 密碼</label><input id="wifi-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} disabled={busy || openNetwork} required={!openNetwork} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            <div className="wifi-checks"><label><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} />顯示密碼</label>
              <label><input type="checkbox" checked={openNetwork} disabled={busy} onChange={e => { setOpenNetwork(e.target.checked); setPassword(''); }} />此網路不需要密碼</label></div>
            <p className="wifi-muted">更新現有網路時請重新輸入密碼。最多儲存 10 個網路；點選上方名稱可帶入 SSID。</p>
            <button type="submit" className="primary" disabled={busy}>{busy ? '處理中…' : '傳送 Wi-Fi 設定'}</button>
          </form>
        </>}
      </>}
      {notice && <p role="status" className="wifi-notice">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
      <p className="wifi-muted">支援 Web Bluetooth 的 Chrome／Edge，需 HTTPS 或 localhost。若找不到 Master，請關閉手機 App 或其他程式的 BLE 連線後再試。</p>
    </div>
  </dialog>;
}
