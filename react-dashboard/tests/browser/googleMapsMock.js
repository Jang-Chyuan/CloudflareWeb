// Offline Maps API double: verifies our overlays and UI, not Google's rendering.
export async function mockGoogleMaps(page) {
  await page.addInitScript(() => {
    const listeners = new WeakMap();
    const event = {
      addListenerOnce(target, name, fn) {
        const item = { fn, once: true };
        const events = listeners.get(target) ?? {};
        (events[name] ??= []).push(item); listeners.set(target, events);
        return { remove: () => { events[name] = events[name].filter(v => v !== item); } };
      },
      trigger(target, name) {
        const events = listeners.get(target) ?? {};
        for (const item of [...(events[name] ?? [])]) { item.fn(); if (item.once) events[name] = events[name].filter(v => v !== item); }
        target.overlays?.forEach(overlay => overlay.draw());
      },
      clearInstanceListeners(target) { listeners.delete(target); },
    };
    class LatLng {
      constructor(lat, lng) { this.latitude = lat; this.longitude = lng; }
      lat() { return this.latitude; } lng() { return this.longitude; }
    }
    class Point { constructor(x, y) { this.x = x; this.y = y; } }
    class LatLngBounds {
      constructor() { this.points = []; }
      extend(p) { this.points.push(p); return this; }
    }
    class Map {
      constructor(div, options) {
        this.div = div; this.center = options.center; this.zoom = options.zoom; this.overlays = new Set();
        this.pane = document.createElement('div');
        Object.assign(this.pane.style, { position: 'absolute', inset: '0' });
        div.replaceChildren(this.pane);
        window.__mapsCreated = (window.__mapsCreated ?? 0) + 1;
      }
      getDiv() { return this.div; } getZoom() { return this.zoom; }
      setZoom(zoom) { this.zoom = zoom; event.trigger(this, 'zoom_changed'); }
      setCenter(center) { this.center = center; event.trigger(this, 'center_changed'); }
      fitBounds(bounds) {
        this.center = { lat: bounds.points.reduce((n, p) => n + p.lat, 0) / bounds.points.length,
          lng: bounds.points.reduce((n, p) => n + p.lng, 0) / bounds.points.length };
        this.zoom = 16; setTimeout(() => event.trigger(this, 'idle'), 0);
      }
    }
    class OverlayView {
      static preventMapHitsAndGesturesFrom() {}
      setMap(map) {
        if (this.map) { this.map.overlays.delete(this); this.onRemove(); }
        this.map = map;
        if (map) { map.overlays.add(this); this.onAdd(); this.draw(); }
      }
      getPanes() { return { overlayMouseTarget: this.map.pane }; }
      getProjection() {
        const map = this.map, scale = 256 * 2 ** map.zoom / 360;
        const toPoint = p => new Point(map.div.clientWidth / 2 + (p.lng() - map.center.lng) * scale,
          map.div.clientHeight / 2 - (p.lat() - map.center.lat) * scale);
        return { fromLatLngToContainerPixel: toPoint, fromLatLngToDivPixel: toPoint,
          fromContainerPixelToLatLng: p => new LatLng(map.center.lat - (p.y - map.div.clientHeight / 2) / scale,
            map.center.lng + (p.x - map.div.clientWidth / 2) / scale) };
      }
    }
    class Polyline { constructor(options) { this.options = options; } setMap(map) { this.map = map; } }
    window.google = { maps: { Map, OverlayView, LatLng, LatLngBounds, Point, Polyline, event } };
  });
}
