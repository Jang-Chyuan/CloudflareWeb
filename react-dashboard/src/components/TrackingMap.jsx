import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps';
import { dogColor, dogName } from '../tracking/telemetry';
import { createDogOverlay } from '../tracking/googleDogOverlay';
import { createRouteOverlay } from '../tracking/routeOverlay';

export default function TrackingMap({ dogs, routes, hidden, focus, aliases, showTrails, onDetails, viewKey, syncing = false }) {
  const host = useRef(null), mapRef = useRef(null), fitKey = useRef(null);
  const detailsRef = useRef(onDetails);
  detailsRef.current = onDetails;
  const [ready, setReady] = useState(false), [error, setError] = useState('');

  useEffect(() => {
    let active = true, map, observer;
    setReady(false); setError('');
    loadGoogleMaps().then(maps => {
      if (!active) return;
      map = new maps.Map(host.current, {
        center: { lat: 23.7, lng: 121 }, zoom: 7, maxZoom: 19,
        mapTypeControl: true,
        mapTypeControlOptions: { mapTypeIds: ['roadmap', 'satellite'] },
        streetViewControl: false, fullscreenControl: true, scaleControl: true,
        clickableIcons: false, gestureHandling: 'greedy',
      });
      mapRef.current = map;
      observer = new ResizeObserver(() => maps.event.trigger(map, 'resize'));
      observer.observe(host.current);
      setReady(true);
    }).catch(failure => { if (active) setError(failure.message); });
    return () => {
      active = false; observer?.disconnect();
      if (map) window.google.maps.event.clearInstanceListeners(map);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const maps = window.google.maps;
    const visible = dogs.filter(dog => dog.position && !hidden.includes(dog.id));
    const positions = visible.map(dog => dog.position), polylines = [];
    const visibleRoutes = showTrails ? routes.filter(route => !hidden.includes(route.id)) : [];
    if (showTrails) for (const route of visibleRoutes) {
      if (hidden.includes(route.id)) continue;
      positions.push(...route.points.map(point => point.position));
      for (const section of route.sections) {
        const scheduled = section.kind === 'scheduled';
        polylines.push(new maps.Polyline({ map, path: section.points.map(([lat, lng]) => ({ lat, lng })),
          strokeColor: dogColor(route.id), strokeWeight: scheduled ? 2 : 4, strokeOpacity: scheduled ? 0 : 0.75,
          icons: scheduled ? [{ icon: { path: 'M 0,-1 0,1', strokeColor: dogColor(route.id), strokeOpacity: 0.4, scale: 2 }, offset: '0', repeat: '12px' }] : [],
          clickable: false }));
      }
    }
    const routeOverlay = createRouteOverlay(maps, map, visibleRoutes, aliases);
    const overlay = createDogOverlay(maps, map, visible, aliases, id => detailsRef.current(id));
    const following = visible.find(dog => dog.id === focus);
    let fitListener;
    if (following) {
      map.setCenter({ lat: following.position[0], lng: following.position[1] });
      map.setZoom(Math.max(map.getZoom() ?? 7, 16));
    }
    const key = `${viewKey}:${focus}:${visible.map(dog => dog.id).join(',')}`;
    if (!following && positions.length && fitKey.current !== key) {
      const bounds = new maps.LatLngBounds();
      positions.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
      fitListener = maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); });
      map.fitBounds(bounds, 55);
      fitKey.current = key;
    }
    return () => { overlay.setMap(null); routeOverlay.setMap(null); polylines.forEach(line => line.setMap(null)); fitListener?.remove(); };
  }, [ready, dogs, routes, hidden, focus, aliases, showTrails, viewKey]);

  return <div className="map-panel">
    <div ref={host} className="map-canvas" aria-label="Slave 位置與移動軌跡地圖" />
    {showTrails && <div className="route-legend" role="note">
      <div>● GPS 定位點　━ 連續取樣　┄ 定時回報位置連接示意</div>
      <div>依取樣間隔分類，非裝置模式確認；虛線不代表實際行走路線。</div>
      {routes.filter(route => !hidden.includes(route.id) && route.points.length).map(route => <div key={route.id}>
        {dogName(route.id, aliases)}：{route.sections.some(part => part.kind === 'tracking') && `連續軌跡估算 ${(route.trackingMeters / 1000).toFixed(2)} km；`}
        {route.sections.some(part => part.kind === 'scheduled') && `定位點間直線距離 ${(route.scheduledMeters / 1000).toFixed(2)} km；`}
        {route.points.length} 個定位點
      </div>)}
      <div>距離僅計算已連接線段，受 GPS 誤差與取樣間隔影響。</div>
    </div>}
    {error && <div className="map-notice" role="alert">{error}</div>}
    {!error && !ready && <div className="map-empty" role="status">正在載入 Google 地圖…</div>}
    {ready && !dogs.some(dog => dog.position && !hidden.includes(dog.id)) &&
      <div className="map-empty" role="status">{syncing ? '資料同步中' : '目前沒有可顯示的即時位置'}<span>{syncing ? '正在讀取犬隻資料，請稍候。' : '可在清單查看最後封包，或切換歷史軌跡。'}</span></div>}
  </div>;
}
