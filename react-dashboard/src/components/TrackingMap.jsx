import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { dogColor, dogName } from '../tracking/telemetry';
import { placeDogLabel, labelLineEnd } from '../tracking/labels';

export default function TrackingMap({ dogs, routes, hidden, focus, aliases, showTrails, onDetails, viewKey, syncing = false }) {
  const host = useRef(null), mapRef = useRef(null), layers = useRef(null), fitKey = useRef(null);
  const detailsRef = useRef(onDetails);
  detailsRef.current = onDetails;
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    const map = L.map(host.current, { zoomControl: false }).setView([23.7, 121], 7);
    mapRef.current = map;
    const connectorPane = map.createPane('dogConnectors');
    connectorPane.style.zIndex = '625';
    connectorPane.style.pointerEvents = 'none';
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    let failures = 0;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).on('tileerror', () => { if (++failures >= 3) setTileError(true); })
      .on('tileload', () => setTileError(false)).addTo(map);
    layers.current = L.featureGroup().addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, group = layers.current;
    if (!map || !group) return;
    group.clearLayers();
    const markers = [];
    const leaders = L.layerGroup().addTo(group);
    const positions = [];
    if (showTrails) for (const route of routes) {
      if (hidden.includes(route.id)) continue;
      for (const segment of route.segments) {
        if (segment.length > 1) {
          L.polyline(segment, { color: dogColor(route.id), weight: 4, opacity: 0.7 }).addTo(group);
          positions.push(...segment);
        }
      }
    }
    for (const dog of dogs) {
      if (!dog.position || dog.stale || hidden.includes(dog.id)) continue;
      const label = document.createElement('span');
      label.textContent = dogName(dog.id, aliases);
      const icon = L.divIcon({ className: 'dog-map-icon', html: `<span class="dog-map-dot" style="background:${dogColor(dog.id)}">🐕</span>`, iconSize: [38, 38], iconAnchor: [19, 19] });
      const marker = L.marker(dog.position, { icon, title: dogName(dog.id, aliases), alt: dogName(dog.id, aliases) })
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -19], className: 'dog-map-label' })
        .on('click', () => detailsRef.current(dog.id)).addTo(group);
      markers.push({ marker, color: dogColor(dog.id) });
      positions.push(dog.position);
    }
    const following = dogs.find(dog => dog.id === focus && !dog.stale && dog.position && !hidden.includes(dog.id));
    if (following) map.setView(following.position, Math.max(map.getZoom(), 16));
    const key = `${viewKey}:${focus}:${dogs.filter(dog => !dog.stale && !hidden.includes(dog.id)).map(dog => dog.id).join(',')}`;
    if (!following && positions.length && fitKey.current !== key) {
      map.fitBounds(L.latLngBounds(positions), { padding: [55, 55], maxZoom: 16 });
      fitKey.current = key;
    }
    function arrangeLabels() {
      leaders.clearLayers();
      const placed = [];
      const connections = [];
      const lines = [];
      const mapBox = host.current.getBoundingClientRect();
      const icons = markers.map(({ marker }) => {
        const p = map.latLngToContainerPoint(marker.getLatLng());
        return { left: p.x - 19, right: p.x + 19, top: p.y - 19, bottom: p.y + 19 };
      });
      for (const { marker, color } of markers) {
        const tooltip = marker.getTooltip();
        tooltip.options.offset = L.point(0, -19);
        tooltip.update();
        const element = tooltip.getElement();
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const point = map.latLngToContainerPoint(marker.getLatLng());
        const box = placeDogLabel(point, rect.width, rect.height, placed, icons,
          { left: 8, top: 8, right: mapBox.width - 8, bottom: mapBox.height - 8 }, lines);
        tooltip.options.offset = L.point(box.left - (rect.left - mapBox.left), -19 + box.top - (rect.top - mapBox.top));
        tooltip.update();
        element.style.setProperty('border-color', color);
        placed.push(box);
        lines.push({ start: point, end: labelLineEnd(point, box) });
        connections.push({ marker, color, box: placed.at(-1) });
      }
      connections.forEach(({ marker, color, box }) => {
        const start = map.latLngToContainerPoint(marker.getLatLng());
        const end = labelLineEnd(start, box);
        const points = [start, end]
          .map(point => map.containerPointToLatLng(point));
        const options = { pane: 'dogConnectors', interactive: false, lineCap: 'round', lineJoin: 'round' };
        L.polyline(points, { ...options, color: '#fff', weight: 3, opacity: 0.95 }).addTo(leaders);
        L.polyline(points, { ...options, color, weight: 1, opacity: 1 }).addTo(leaders);
      });
    }
    arrangeLabels();
    map.on('zoomend moveend resize', arrangeLabels);
    return () => map.off('zoomend moveend resize', arrangeLabels);
  }, [dogs, routes, hidden, focus, aliases, showTrails, viewKey]);

  return <div className="map-panel">
    <div ref={host} className="map-canvas" aria-label="Slave 位置與移動軌跡地圖" />
    {tileError && <div className="map-notice" role="status">底圖暫時無法載入，犬隻資料仍可查看。</div>}
    {!dogs.some(dog => dog.position && !dog.stale && !hidden.includes(dog.id)) &&
      <div className="map-empty" role="status">{syncing ? '資料同步中' : '目前沒有可顯示的即時位置'}<span>{syncing ? '正在讀取犬隻資料，請稍候。' : '可在清單查看最後封包，或切換歷史軌跡。'}</span></div>}
  </div>;
}
