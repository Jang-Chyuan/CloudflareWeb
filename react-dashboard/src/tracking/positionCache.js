import { coordinate } from './telemetry';

const key = owner => `dogtracker-last-positions:${owner}`;

export function readPositionCache(storage, owner) {
  try {
    const rows = JSON.parse(storage.getItem(key(owner)) ?? '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => row.positionSource !== 'fixed' && Number.isInteger(row.id) && Number.isInteger(row.masterId)
      && Array.isArray(row.position) && coordinate(...row.position)
      && Number.isFinite(row.lastPositionAt)).map(row => ({
      ...row, packet: {}, stale: true, retained: true, lastDisplayed: true,
      charging: false, fixedReason: null, speed: null, battery: null,
      status: '未收到新定位',
    }));
  } catch { return []; }
}

export function savePositionCache(storage, owner, dogs) {
  try {
    const rows = dogs.filter(dog => dog.position && Number.isFinite(dog.lastPositionAt)).map(dog => ({
      id: dog.id, masterId: dog.masterId, position: dog.position,
      lastPositionAt: dog.lastPositionAt, lastPacketAt: dog.lastPacketAt,
      positionSource: dog.positionSource, fixedName: dog.fixedName,
    }));
    storage.setItem(key(owner), JSON.stringify(rows));
  } catch { /* The in-memory last position remains available if storage is blocked. */ }
}
