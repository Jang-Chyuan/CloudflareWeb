import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps';
import { dogColor } from '../tracking/telemetry';
import { createDogOverlay } from '../tracking/googleDogOverlay';

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
    if (showTrails) for (const route of routes) {
      if (hidden.includes(route.id)) continue;
      for (const segment of route.segments) if (segment.length > 1) {
        polylines.push(new maps.Polyline({ map, path: segment.map(([lat, lng]) => ({ lat, lng })),
          strokeColor: dogColor(route.id), strokeWeight: 4, strokeOpacity: 0.7, clickable: false }));
        positions.push(...segment);
      }
    }
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
    return () => { overlay.setMap(null); polylines.forEach(line => line.setMap(null)); fitListener?.remove(); };
  }, [ready, dogs, routes, hidden, focus, aliases, showTrails, viewKey]);

  return <div className="map-panel">
    <div ref={host} className="map-canvas" aria-label="Slave 位置與移動軌跡地圖" />
    {error && <div className="map-notice" role="alert">{error}</div>}
    {!error && !ready && <div className="map-empty" role="status">正在載入 Google 地圖…</div>}
    {ready && !dogs.some(dog => dog.position && !hidden.includes(dog.id)) &&
      <div className="map-empty" role="status">{syncing ? '資料同步中' : '目前沒有可顯示的即時位置'}<span>{syncing ? '正在讀取犬隻資料，請稍候。' : '可在清單查看最後封包，或切換歷史軌跡。'}</span></div>}
  </div>;
}
