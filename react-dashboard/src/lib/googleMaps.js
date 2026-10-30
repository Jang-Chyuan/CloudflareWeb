let pending;

export function loadGoogleMaps() {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (pending) return pending;
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('尚未設定 Google Maps API Key，請設定 VITE_GOOGLE_MAPS_API_KEY。'));
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const callback = '__dogTrackerMapsReady';
    const timer = setTimeout(() => fail(), 20000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      delete window[callback];
      reject(new Error('Google 地圖無法載入，請確認網路、API Key 與帳務設定。'));
    }
    window[callback] = () => {
      clearTimeout(timer);
      delete window[callback];
      resolve(window.google.maps);
    };
    const params = new URLSearchParams({ key, callback, loading: 'async', v: 'quarterly', language: 'zh-TW', region: 'TW' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch(error => { pending = null; throw error; });
  return pending;
}
