import { labelStatus, labelMode } from './labelStatus';
﻿import { dogColor, dogName, formatTime, positionDisplayState } from './telemetry';
import { placeDogLabel, labelLineEnd, spreadDogIcons } from './labels';

export function createDogOverlay(maps, map, dogs, aliases, onDetails) {
  class DogOverlay extends maps.OverlayView {
    onAdd() {
      this.root = document.createElement('div');
      this.root.className = 'google-dog-overlay';
      this.root.style.position = 'absolute';
      this.root.style.pointerEvents = 'none';
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.classList.add('dog-connectors');
      this.root.appendChild(this.svg);
      this.items = dogs.map(dog => {
        const positionState = positionDisplayState(dog);
        const icon = document.createElement('button');
        icon.className = `dog-map-icon${positionState === 'expired' ? ' dog-map-stale' : positionState === 'retained' ? ' dog-map-retained' : ''}`;
        icon.title = dogName(dog.id, aliases);
        icon.setAttribute('aria-label', dogName(dog.id, aliases));
        const dot = document.createElement('span');
        dot.className = 'dog-map-dot';
        dot.style.background = dogColor(dog.id);
        dot.textContent = '🐕';
        if (positionState === 'expired') {
          const cross = document.createElement('span');
          cross.className = 'dog-stale-cross'; cross.textContent = '×'; dot.appendChild(cross);
        }
        if (positionState === 'retained') {
          const warning = document.createElement('span');
          warning.className = 'dog-retained-warning'; warning.textContent = '!';
          warning.title = '顯示最後有效位置'; dot.appendChild(warning);
        }
        icon.appendChild(dot);
        icon.onclick = () => onDetails(dog.id);
        maps.OverlayView.preventMapHitsAndGesturesFrom(icon);
        const label = document.createElement('div');
        label.className = 'dog-map-label';
        label.style.borderColor = dogColor(dog.id);
        const { packetAt, battery, rssi } = labelStatus(dog);
        for (const text of [
          `名字：${dogName(dog.id, aliases)}`,
          `裝置模式：${labelMode(dog)}`,
          `最後封包：${formatTime(packetAt)}`,
          `電量：${Number.isFinite(battery) ? `${battery}%` : '—'}`,
          `RSSI：${Number.isFinite(rssi) ? `${rssi} dBm` : '—'}`,
          `最後定位：${formatTime(dog.lastPositionAt)}`,
        ]) {
          const row = document.createElement('div'); row.textContent = text; label.appendChild(row);
        }
        if (positionState === 'retained') {
          const warning = document.createElement('div');
          warning.className = 'dog-retained-note'; warning.textContent = '顯示最後有效位置';
          label.appendChild(warning);
        }
        this.root.append(icon, label);
        return { dog, icon, label, color: dogColor(dog.id) };
      });
      this.getPanes().overlayMouseTarget.appendChild(this.root);
    }
    draw() {
      if (!this.root) return;
      const projection = this.getProjection();
      const origin = projection.fromContainerPixelToLatLng(new maps.Point(0, 0));
      const offset = projection.fromLatLngToDivPixel(origin);
      const { clientWidth: width, clientHeight: height } = map.getDiv();
      Object.assign(this.root.style, { left: `${offset.x}px`, top: `${offset.y}px`, width: `${width}px`, height: `${height}px` });
      this.svg.setAttribute('width', width); this.svg.setAttribute('height', height);
      this.svg.replaceChildren();
      const originals = this.items.map(({ dog }) => projection.fromLatLngToContainerPixel(new maps.LatLng(...dog.position)));
      const points = spreadDogIcons(originals);
      const icons = points.map(p => ({ left: p.x - 19, right: p.x + 19, top: p.y - 19, bottom: p.y + 19 }));
      const placed = [], lines = [];
      const drawLine = (start, end, color) => {
        for (const [stroke, weight] of [['#fff', 3], [color, 1]]) {
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M${start.x},${start.y}L${end.x},${end.y}`);
          path.setAttribute('stroke', stroke); path.setAttribute('stroke-width', weight); path.setAttribute('fill', 'none');
          this.svg.appendChild(path);
        }
      };
      this.items.forEach(({ icon, color }, i) => {
        const p = points[i], original = originals[i];
        Object.assign(icon.style, { left: `${p.x - 19}px`, top: `${p.y - 19}px` });
        if (Math.hypot(p.x - original.x, p.y - original.y) > 1) {
          lines.push({ start: original, end: p }); drawLine(original, p, color);
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          for (const [key, value] of Object.entries({ cx: original.x, cy: original.y, r: 3, fill: color })) circle.setAttribute(key, value);
          this.svg.appendChild(circle);
        }
      });
      this.items.forEach(({ label, color }, i) => {
        const p = points[i];
        const box = placeDogLabel(p, label.offsetWidth, label.offsetHeight, placed, icons,
          { left: 8, top: 8, right: width - 8, bottom: height - 8 }, lines);
        Object.assign(label.style, { left: `${box.left}px`, top: `${box.top}px` });
        placed.push(box);
        const end = labelLineEnd(p, box);
        lines.push({ start: p, end }); drawLine(p, end, color);
      });
    }
    onRemove() { this.root?.remove(); this.root = null; }
  }
  const overlay = new DogOverlay();
  overlay.setMap(map);
  return overlay;
}
