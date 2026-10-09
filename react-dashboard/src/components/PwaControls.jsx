import React, { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PwaControls() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [standalone, setStandalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError() { setError('離線功能尚未準備完成，請連線後重新整理。'); },
  });

  useEffect(() => {
    const beforeInstall = event => { event.preventDefault(); setInstallPrompt(event); };
    const installed = () => { setInstallPrompt(null); setStandalone(true); };
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    const checkForUpdate = () => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        navigator.serviceWorker?.getRegistration().then(registration => registration?.update()).catch(() => {});
      }
    };
    const timer = setInterval(checkForUpdate, 60 * 60 * 1000);
    window.addEventListener('online', checkForUpdate);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('online', connection); window.removeEventListener('offline', connection);
      window.removeEventListener('online', checkForUpdate); clearInterval(timer);
    };
  }, []);

  async function install() {
    if (!installPrompt || installing) return;
    setInstalling(true); setError('');
    try { await installPrompt.prompt(); await installPrompt.userChoice; }
    catch { setError('請使用瀏覽器選單中的「安裝」或「加入主畫面」。'); }
    finally { setInstallPrompt(null); setInstalling(false); }
  }
  async function update() {
    setError('');
    try { await updateServiceWorker(true); }
    catch { setError('更新失敗，請確認連線後重試。'); }
  }

  return <div className="pwa-controls">
    {!online && <div className="pwa-notice" role="status">離線中 · 可開啟已快取的介面；登入、最新犬隻資料與底圖需要網路。</div>}
    {error && <div className="pwa-notice" role="alert">{error}<button className="text-button" onClick={() => setError('')}>關閉</button></div>}
    {needRefresh && <div className="pwa-notice pwa-update" role="status"><span>新版本已就緒</span><button className="primary" onClick={update}>更新並重新開啟</button><button className="text-button" onClick={() => setNeedRefresh(false)}>稍後</button></div>}
    {!standalone && installPrompt && <button className="pwa-install secondary" disabled={installing} onClick={install}>{installing ? '安裝中…' : '＋ 安裝 DogWebTracker'}</button>}
    {!standalone && ios && !installPrompt && <details className="pwa-ios"><summary>加入主畫面</summary><p>在 Safari 點「分享」，選擇「加入主畫面」。</p></details>}
  </div>;
}
