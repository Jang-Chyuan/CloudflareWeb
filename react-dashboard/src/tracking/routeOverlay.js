import { dogColor, dogName, formatTime } from './telemetry';

// OverlayView keeps sparse and isolated fixes visible without a marker per fix.
export function createRouteOverlay(maps, map, routes, aliases) {
  class RouteOverlay extends maps.OverlayView {
    onAdd() {
      this.root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.root.classList.add('route-points');
      Object.assign(this.root.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' });
      this.items = routes.flatMap(route => route.points.map(point => {
        const circle = document.createElementNS(this.root.namespaceURI, 'circle');
        circle.setAttribute('r', '3');
        circle.setAttribute('fill', dogColor(route.id));
        circle.setAttribute('stroke', 'white');
        circle.setAttribute('stroke-width', '1');
        circle.style.pointerEvents = 'auto';
        const title = document.createElementNS(this.root.namespaceURI, 'title');
        title.textContent = `${dogName(route.id, aliases)} · ${formatTime(point.time)} · GPS 定位點`;
        circle.appendChild(title);
        this.root.appendChild(circle);
        return { circle, position: point.position };
      }));
      this.getPanes().overlayMouseTarget.appendChild(this.root);
    }
    draw() {
      const projection = this.getProjection();
      if (!projection) return;
      for (const { circle, position } of this.items) {
        const pixel = projection.fromLatLngToDivPixel(new maps.LatLng(...position));
        circle.setAttribute('cx', pixel.x);
        circle.setAttribute('cy', pixel.y);
      }
    }
    onRemove() { this.root?.remove(); }
  }
  const overlay = new RouteOverlay();
  overlay.setMap(map);
  return overlay;
}
