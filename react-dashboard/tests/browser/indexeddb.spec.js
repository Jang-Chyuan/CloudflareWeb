import { test, expect } from '@playwright/test';

test('IndexedDB persists packets and isolates accounts, ranges and revoked permissions', async ({ page }) => {
  await page.goto('/');
  const now = Date.now();
  await page.evaluate(async now => {
    const cache = await import('/src/tracking/telemetryCache.js');
    await cache.updateCachedMasters('a', [201, 202], now);
    await cache.updateCachedMasters('b', [201], now);
    await cache.saveCachedTelemetry('a', [
      { id: 'one', master_id: 201, received_at: now - 1000, raw: { payload: { lat: 123 } } },
      { id: 'two', master_id: 202, received_at: now - 2000 },
      { id: 'old', master_id: 201, received_at: now - 16 * 86400000 },
    ], now);
    await cache.saveCachedTelemetry('b', [{ id: 'one', master_id: 201, received_at: now - 1000, marker: 'b' }], now);
    await cache.saveCachedTelemetry('a', [{ id: 'one', master_id: 201, received_at: now - 1000, raw: { payload: { lat: 456 } } }], now);
  }, now);
  await page.reload();
  const result = await page.evaluate(async now => {
    const cache = await import('/src/tracking/telemetryCache.js');
    const a = await cache.readCachedTelemetry('a', 0, now);
    const b = await cache.readCachedTelemetry('b', 0, now);
    const unknown = await cache.readCachedTelemetry('unknown', 0, now);
    const range = await cache.readCachedTelemetry('a', now - 1500, now);
    await cache.updateCachedMasters('a', [202], now);
    const revoked = await cache.readCachedTelemetry('a', 0, now);
    await cache.updateCachedMasters('a', [201, 202], now);
    const reallowed = await cache.readCachedTelemetry('a', 0, now);
    await cache.updateCachedMasters('b', [201], now + 16 * 86400000);
    const expired = await cache.readCachedTelemetry('b', 0, now + 17 * 86400000);
    return { a, b, unknown, range, revoked, reallowed, expired };
  }, now);
  expect(result.a.rows).toHaveLength(2);
  expect(result.a.rows.find(row => row.id === 'one').raw.payload.lat).toBe(456);
  expect(result.b.rows[0].marker).toBe('b');
  expect(result.unknown).toEqual({ masters: [], rows: [] });
  expect(result.range.rows.map(row => row.id)).toEqual(['one']);
  expect(result.revoked.rows.map(row => row.id)).toEqual(['two']);
  expect(result.reallowed.rows.map(row => row.id)).toEqual(['two']);
  expect(result.expired.rows).toEqual([]);
});
