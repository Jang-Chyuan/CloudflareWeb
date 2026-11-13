import { dogColor, dogName, formatTime } from './telemetry';

// OverlayView keeps sparse and isolated fixes visible without a marker per fix.
export function createRouteOverlay(maps, map, routes, aliases) {
  class RouteOverlay extends maps.OverlayView {
    onAdd() {
      this.root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.root.classList.add('route-points');
      Object.assign(this.root.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' });
      this.items = routes.flatMap(route => route.points.map(point => {
        const marker = document.createElementNS(this.root.namespaceURI, 'text');
        marker.classList.add('gps-fix-marker');
        marker.textContent = '*';
        marker.setAttribute('text-anchor', 'middle');
        marker.setAttribute('dominant-baseline', 'central');
        marker.setAttribute('font-family', 'monospace');
        marker.setAttribute('font-size', '22');
        marker.setAttribute('font-weight', 'bold');
        marker.setAttribute('paint-order', 'stroke');
        marker.setAttribute('fill', dogColor(route.id));
        marker.setAttribute('stroke', 'white');
        marker.setAttribute('stroke-width', '2');
        marker.style.pointerEvents = 'auto';
        const title = document.createElementNS(this.root.namespaceURI, 'title');
        title.textContent = `${dogName(route.id, aliases)} · ${formatTime(point.time)} · GPS 定位點`;
        marker.appendChild(title);
        this.root.appendChild(marker);
        return { marker, position: point.position };
      }));
      this.getPanes().overlayMouseTarget.appendChild(this.root);
    }
    draw() {
      const projection = this.getProjection();
      if (!projection) return;
      const origin = projection.fromContainerPixelToLatLng(new maps.Point(0, 0));
      const offset = projection.fromLatLngToDivPixel(origin);
      const { clientWidth: width, clientHeight: height } = map.getDiv();
      // Maps overlay panes do not provide a reliable percentage SVG viewport.
      Object.assign(this.root.style, { inset: 'auto', left: `${offset.x}px`, top: `${offset.y}px`,
        width: `${width}px`, height: `${height}px` });
      this.root.setAttribute('width', width);
      this.root.setAttribute('height', height);
      for (const { marker, position } of this.items) {
        const pixel = projection.fromLatLngToContainerPixel(new maps.LatLng(...position));
        marker.setAttribute('x', pixel.x);
        marker.setAttribute('y', pixel.y);
      }
    }
    onRemove() { this.root?.remove(); }
  }
  const overlay = new RouteOverlay();
  overlay.setMap(map);
  return overlay;
}
