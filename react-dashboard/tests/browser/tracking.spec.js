import { test, expect } from '@playwright/test';
import { mockGoogleMaps } from './googleMapsMock';

test.beforeEach(async ({ page }) => { await mockGoogleMaps(page); });

test('sparse routes show fixes and dashed connections alongside dense solid tracks', async ({ page }) => {
  await mockCloud(page);
  const now = Date.now();
  const rows = [61, 31, 1, 0.5].map((minutes, index) => ({
    event_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    master_id: 5, slave_id: 2, seq: index, received_at: new Date(now - minutes * 60000).toISOString(),
    payload: { lat: 25033000 + index * 100, lon: 121565000 },
  }));
  await page.route('**/rest/v1/dog_telemetry*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('or') ? [] : rows }));
  await login(page, 1);
  await page.locator('#route-window').selectOption('360');
  await expect(page.locator('.route-points circle')).toHaveCount(4);
  await expect(page.locator('.route-legend')).toContainText('定位點間直線距離');
  await expect(page.locator('.route-legend')).toContainText('連續軌跡估算');
  expect(await page.evaluate(() => window.__routeLines.filter(line => line.map).map(line => ({
    dashed: line.options.strokeOpacity === 0 && line.options.icons.length > 0,
    count: line.options.path.length,
  })))).toEqual([{ dashed: true, count: 3 }, { dashed: false, count: 2 }]);
  await page.getByLabel('移動路徑', { exact: true }).uncheck();
  await expect(page.locator('.route-points circle')).toHaveCount(0);
  await expect(page.locator('.route-legend')).toHaveCount(0);
  await page.getByLabel('移動路徑', { exact: true }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.route-legend')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const owner = '00000000-0000-4000-8000-000000000010';
async function mockCloud(page, clustered = false, remote = false) {
  const now = Date.now();
  const user = { id: owner, email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date(now).toISOString() };
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp: Math.floor(now / 1000) + 3600 })).toString('base64url')}.test_signature`;
  const packet = (id, slave, ago, lat = 25033000) => ({
    event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    master_id: 5, slave_id: slave, seq: id, received_at: new Date(now - ago).toISOString(),
    payload: { lat, lon: 121565000, speed: 1250, hdop: 150, satellites: 9, batteryPercentage: 82,
      batteryValid: 1, activityScore: 650, activityValid: 1, usbPresent: 0 }, rssi: -91, snr: 5,
  });
  const rows = clustered ? [4, 6, 8, 108].map((slave, i) => packet(i + 1, slave, 15000, 25033000 + i * 15))
    : [packet(1, 2, 45000), packet(2, 2, 15000, 25033200), packet(3, 9, 2160000)];
  if (remote) rows.splice(0, rows.length, { ...packet(1, 102, 15000), master_id: typeof remote === 'string' ? 5 : 201 });
  const requested = [];
  const names = [];
  await page.route('http://127.0.0.1:54321/**', async route => {
    const url = new URL(route.request().url()); requested.push(url.pathname);
    let body = {};
    if (url.pathname.endsWith('/token')) body = { access_token: token, refresh_token: 'test_refresh_token', token_type: 'bearer', expires_in: 3600, user };
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.endsWith('/logout')) body = {};
    else if (url.pathname.endsWith('/device_members')) body = Number(url.searchParams.get('offset')) > 0 ? [] : (remote === 'relay' ? [{ gateway_id: 'master_201', slave_id: null }, { gateway_id: 'master_5', slave_id: null }] : [{ gateway_id: remote === 'relay-only' ? 'master_5' : remote ? 'master_201' : 'master_5', slave_id: null }]);
    else if (url.pathname.endsWith('/dog_telemetry')) body = url.searchParams.has('or') ? [] : rows;
    else if (url.pathname.endsWith('/device_commands')) body = [];
    else if (url.pathname.endsWith('/dog_health')) body = [{
      event_id: '00000000-0000-4000-8000-000000000099', master_id: 5,
      slave_id: Number(url.searchParams.get('slave_id')?.replace('eq.', '')),
      received_at: new Date(now - 5000).toISOString(), battery_pct: 63, battery_valid: true, rssi: -72,
    }];
    else if (url.pathname.endsWith('/slave_fixed_locations')) body = [];
    else if (url.pathname.endsWith('/slave_names')) {
      if (route.request().method() === 'POST') {
        const value = route.request().postDataJSON();
        names.splice(0, names.length, { slave_id: value.slave_id, name: value.name });
        body = names[0];
      } else body = names;
    }
    else if (url.pathname.endsWith('/unlock-fixed-location')) return route.fulfill({ status: 403, json: { error: 'Invalid password' } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return requested;
}

async function login(page, dogCount = 2, showAll = true) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('密碼', { exact: true }).fill('test_password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible();
  await expect(page.locator('.dog-card')).toHaveCount(dogCount);
  if (showAll) await page.getByRole('button', { name: '顯示全部', exact: true }).click();
}

test('downloaded packets restore after reload and support offline history', async ({ page }) => {
  await mockCloud(page);
  await login(page);
  await expect.poll(() => page.evaluate(async owner => {
    const { readCachedTelemetry } = await import('/src/tracking/telemetryCache.js');
    return (await readCachedTelemetry(owner, 0, Date.now())).rows.length;
  }, owner)).toBe(3);
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
  await page.reload();
  await expect(page.locator('.dog-card')).toHaveCount(2);
  await expect(page.getByText('已載入本機資料', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '歷史軌跡', exact: false }).click();
  await page.getByRole('button', { name: '查詢軌跡', exact: true }).click();
  await expect(page.getByText('離線：僅顯示已下載的本機資料', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '匯出 CSV', exact: false })).toBeEnabled();
});

test('custom 15-day period queries older cloud routes, caches them and works offline on mobile', async ({ page }) => {
  await mockCloud(page);
  await login(page);
  const start = Math.floor((Date.now() - 10 * 86400000) / 60000) * 60000;
  const end = start + 3600000;
  const values = [start - 1000, start + 1000, start + 61000, end + 1000].map((time, i) => ({
    event_id: `00000000-0000-4000-8000-${String(201 + i).padStart(12, '0')}`,
    master_id: 5, slave_id: 2, received_at: new Date(time).toISOString(),
    payload: { lat: 25033000 + i * 100, lon: 121565000 },
  }));
  let requestedRange;
  await page.route('**/rest/v1/dog_telemetry*', route => {
    const url = new URL(route.request().url());
    const bounds = url.searchParams.getAll('received_at');
    const lower = Date.parse(bounds.find(value => value.startsWith('gte.'))?.slice(4));
    const upper = Date.parse(bounds.find(value => value.startsWith('lt.'))?.slice(3));
    requestedRange = { lower, upper };
    return route.fulfill({ json: url.searchParams.has('or') ? [] : values.filter(row => {
      const time = Date.parse(row.received_at); return time >= lower && time < upper;
    }) });
  });
  const inputTime = time => new Date(time + 8 * 3600000).toISOString().slice(0, 16);
  async function selectPeriod() {
    await page.locator('#route-window').selectOption('custom');
    await expect(page.getByLabel('查詢方式')).toHaveValue('time');
    await page.getByLabel('開始時間（台灣）').fill(inputTime(start));
    await page.getByLabel('結束時間（台灣）').fill(inputTime(end));
    await page.getByRole('button', { name: '查詢軌跡', exact: true }).click();
    await expect(page.locator('.route-points circle')).toHaveCount(2);
  }
  await selectPeriod();
  expect(requestedRange).toEqual({ lower: start, upper: end });
  await expect.poll(() => page.evaluate(async ({ owner, start, end }) => {
    const cache = await import('/src/tracking/telemetryCache.js');
    return (await cache.readCachedTelemetry(owner, start, end)).rows.length;
  }, { owner, start, end })).toBe(2);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暫停', exact: true })).toBeVisible();
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await selectPeriod();
  await expect(page.getByText('離線：僅顯示已下載的本機資料', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('cloud tracking still works when IndexedDB is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
  await mockCloud(page);
  await login(page);
  await expect(page.getByText('本機儲存失敗或空間不足', { exact: false })).toBeVisible();
});

test('clustered labels do not overlap and connectors appear above markers', async ({ page }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await mockCloud(page, true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, 4, false);
  await expect(page.locator('.dog-map-icon')).toHaveCount(1);
  await expect(page.locator('.dog-map-label')).toHaveCount(1);
  await expect(page.locator('.dog-map-label')).toContainText('名字：狗 108');
  await expect(page.locator('.dog-map-label')).toContainText('最後封包：');
  await expect(page.locator('.dog-map-label')).toContainText('電量：');
  await expect(page.locator('.dog-map-label')).toContainText('電量：63%');
  await expect(page.locator('.dog-map-label')).toContainText('RSSI：-72 dBm');
  await expect(page.locator('.dog-map-label')).toContainText('最後定位：');
  await page.getByRole('button', { name: '顯示全部', exact: true }).click();
  await expect(page.locator('.dog-map-label')).toHaveCount(4);
  await expect.poll(() => page.locator('.dog-connectors path').count()).toBeGreaterThanOrEqual(8);
  await expect.poll(async () => {
  const icons = await page.locator('.dog-map-icon').evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
  for (let i = 0; i < icons.length; i++) for (let j = i + 1; j < icons.length; j++) {
    const a = icons[i], b = icons[j];
    if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) return false;
  }
  return true;
  }).toBe(true);
  async function checkLabels() {
    await expect.poll(async () => {
    const boxes = await page.locator('.dog-map-label').evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) return false;
    }
    return true;
    }).toBe(true);
  }
  await checkLabels();
  const z = await page.locator('.dog-connectors').evaluate(element => ({
    lines: Number(getComputedStyle(element).zIndex),
    markers: Number(getComputedStyle(document.querySelector('.dog-map-icon')).zIndex),
    labels: Number(getComputedStyle(document.querySelector('.dog-map-label')).zIndex),
  }));
  expect(z.lines).toBeGreaterThan(z.markers);
  expect(z.lines).toBeLessThan(z.labels);
  await page.screenshot({ path: 'test-results/clustered-labels-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.locator('.dog-connectors path').count()).toBeGreaterThanOrEqual(8);
  await checkLabels();
  await page.screenshot({ path: 'test-results/clustered-labels-mobile.png', fullPage: true });
  expect(failures).toEqual([]);
});

test('login, Slave map, detail, history playback and logout without phone location', async ({ page }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const requested = await mockCloud(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition() { throw new Error('Phone geolocation must not be called'); },
      watchPosition() { throw new Error('Phone geolocation must not be called'); },
    } });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await login(page);
  await expect(page.locator('.dog-map-icon')).toHaveCount(2);
  await expect(page.locator('.dog-map-stale')).toHaveCount(1);
  const dog = page.locator('.dog-card').filter({ hasText: '狗 2' });
  await expect(dog).toContainText('12.5'); await expect(dog).toContainText('82%');
  await dog.getByRole('button', { name: '地圖跟隨', exact: true }).click();
  await expect(dog).toContainText('取消跟隨');
  await dog.getByRole('button', { name: '隱藏狗 2位置' }).click();
  await expect(page.locator('.dog-map-icon')).toHaveCount(1);
  await dog.getByRole('button', { name: '顯示狗 2位置' }).click();
  await expect(page.locator('.dog-map-icon')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/slave-desktop.png', fullPage: true });
  await dog.locator('.dog-title').click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('-91 dBm'); await expect(dialog).toContainText('過去 24 小時活動量');
  await dialog.getByLabel('名稱（儲存在 Supabase）', { exact: true }).fill('小白');
  await dialog.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('名稱已儲存至 Supabase');
  await expect(page.locator('.dog-map-icon[title="小白(2)"]')).toHaveCount(1);
  await expect(page.locator('.dog-map-label').filter({ hasText: '名字：小白(2)' })).toHaveCount(1);
  await expect(dialog.getByRole('heading', { name: '固定位置設定' })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'ML 推論結果' })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '↝ 歷史軌跡', exact: true }).click();
  await page.getByRole('button', { name: '查詢軌跡', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暫停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暫停', exact: true }).click();
  await page.locator('tbody').getByRole('button', { name: '查看', exact: true }).first().click();
  await expect(page.locator('tbody pre')).toContainText('activityScore');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 CSV ↓' }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/DogWebTracker.*\.csv$/);
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登入 DogWebTracker' })).toBeVisible();
  await expect(page.locator('.dog-card')).toHaveCount(0);
  expect(requested.some(path => path.includes('gps_logs') || path.includes('phone_locations'))).toBe(false);
  expect(failures).toEqual([]);
});

test('mobile layout stays within viewport and login failure stays visible', async ({ page }) => {
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  await mockCloud(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/slave-mobile.png', fullPage: true });
  await expect(page.getByRole('button', { name: /^ML 推論：/ })).toHaveCount(0);
  await page.locator('.dog-card').filter({ hasText: '狗 2' }).locator('.dog-title').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const box = await page.getByRole('dialog').boundingBox(); expect(box.width).toBeLessThan(391);
  await page.getByRole('button', { name: '關閉詳細資訊' }).click();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await page.route('**/auth/v1/token**', route => route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } }));
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('密碼', { exact: true }).fill('incorrect_test_password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('登入失敗');
  expect(failures).toEqual([]);
});


test('remote tracking and sleep write commands without claiming execution', async ({ page }) => {
  await mockCloud(page, false, true);
  const submitted = [];
  let latest = null;
  await page.route('**/rest/v1/device_commands*', route => route.fulfill({ json: latest ? [latest] : [] }));
  await page.route('**/rest/v1/rpc/create_device_command', async route => {
    const body = route.request().postDataJSON(); submitted.push(body);
    latest = { id: crypto.randomUUID(), action: body.p_action, request_id: body.p_request_id, status: 'queued', expires_at: new Date(Date.now() + 60000).toISOString() };
    await route.fulfill({ json: latest });
  });
  await login(page, 1);
  await expect(page.locator('.command-buttons')).toHaveCount(0);
  await page.locator('.dog-map-icon').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '要求開始追蹤', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Slave 102 遠端控制' })).toContainText('追蹤命令已送出，等待裝置確認');
  await expect(page.getByRole('button', { name: '要求開始追蹤', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '要求省電待機', exact: true })).toBeDisabled();
  latest = { ...latest, status: 'confirmed', reported_mode: 1, completed_at: new Date().toISOString() };
  await expect(page.getByRole('button', { name: '要求省電待機', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '要求省電待機', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Slave 102 遠端控制' })).toContainText('待機命令已送出，等待裝置確認');
  expect(submitted.map(row => [row.p_master_id, row.p_slave_id, row.p_action])).toEqual([[201, 102, 'tracking'], [201, 102, 'sleep']]);
  expect(submitted[0].p_request_id).not.toBe(submitted[1].p_request_id);
  latest = { ...latest, status: 'unconfirmed', completed_at: new Date().toISOString() };
  const retry = page.getByRole('button', { name: '重試省電待機命令', exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  expect(submitted[2].p_action).toBe('sleep');
  expect(submitted[2].p_request_id).not.toBe(submitted[1].p_request_id);
  await expect(page.getByRole('button', { name: '要求開始追蹤', exact: true })).toBeDisabled();
  await expect(retry).toHaveCount(0);
  await page.getByRole('dialog').locator('.detail-header button').click();
  await expect(page.locator('.command-buttons')).toHaveCount(0);
  await page.locator('.dog-map-icon').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '要求開始追蹤', exact: true })).toBeVisible();
});

test('ambiguous command failure retries with same UUID and offline disables buttons', async ({ page, context }) => {
  await mockCloud(page, false, true);
  const submitted = [];
  await page.route('**/rest/v1/rpc/create_device_command', async route => {
    submitted.push(route.request().postDataJSON());
    if (submitted.length === 1) return route.fulfill({ status: 403, json: { code: '42501', message: 'Device access denied' } });
    return route.fulfill({ json: { id: crypto.randomUUID(), action: 'tracking', status: 'queued', expires_at: new Date(Date.now() + 60000).toISOString() } });
  });
  await login(page, 1);
  await expect(page.locator('.command-buttons')).toHaveCount(0);
  await page.locator('.dog-map-icon').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const button = page.getByRole('button', { name: '要求開始追蹤', exact: true });
  await button.click();
  await expect(page.getByRole('alert')).toContainText('送出未確認');
  await expect(button).toBeDisabled();
  await page.getByRole('button', { name: '重試追蹤命令', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Slave 102 遠端控制' })).toContainText('等待裝置確認');
  expect(submitted[0].p_request_id).toBe(submitted[1].p_request_id);
  await context.setOffline(true);
  await expect(button).toBeDisabled();
  await context.setOffline(false);
  await expect(button).toBeDisabled();
});

test('other devices have no remote control buttons', async ({ page }) => {
  await mockCloud(page);
  await login(page);
  await expect(page.getByRole('button', { name: '要求開始追蹤', exact: true })).toHaveCount(0);
});

test('device mode uses confirmed reported mode and Taiwan confirmation time', async ({ page }) => {
  await mockCloud(page, false, true);
  let command = { id: 'mode-test', master_id: 201, slave_id: 102, action: 'tracking', status: 'queued', reported_mode: 1,
    completed_at: '2026-11-01T02:00:00Z', expires_at: '2099-01-01T00:00:00Z' };
  let readFailure = false;
  await page.route('**/rest/v1/device_commands*', route => readFailure
    ? route.fulfill({ status: 403, json: { message: 'Temporary read failure' } })
    : route.fulfill({ json: [command] }));
  await login(page, 1);
  await expect(page.locator('.dog-map-label')).toContainText('裝置模式：未知');
  await page.locator('.dog-map-icon').click();
  const mode = page.locator('.device-mode');
  await expect(mode).toContainText('未知');
  await expect(page.locator('.command-buttons .primary')).toHaveCount(0);
  command = { ...command, status: 'confirmed' };
  await expect(mode).toContainText('追蹤中');
  await expect(page.locator('.dog-map-label')).toContainText('裝置模式：追蹤中');
  await expect(mode).toContainText('10:00:00');
  await expect(mode.locator('.device-mode-tracking')).toHaveCount(1);
  readFailure = true;
  await expect(page.locator('.dog-map-label')).toContainText('裝置模式：追蹤中（上次確認）');
  readFailure = false;
  await expect(page.locator('.dog-map-label')).not.toContainText('上次確認');
  command = { ...command, action: 'sleep', reported_mode: 0 };
  await expect(mode).toContainText('省電待機');
  await expect(page.locator('.dog-map-label')).toContainText('裝置模式：省電待機');
  await expect(mode.locator('.device-mode-tracking')).toHaveCount(0);
  command = { ...command, status: 'expired' };
  await expect(mode).toContainText('未知');
  await expect(page.locator('.dog-map-label')).toContainText('裝置模式：未知');
  await expect(page.locator('.device-commands')).toContainText('未收到確認，裝置模式未知');
});

test('Slave 102 controls remain available when telemetry arrives via Master 5', async ({ page }) => {
  await mockCloud(page, false, 'relay');
  const submitted=[];
  await page.route('**/rest/v1/rpc/create_device_command', async route => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({json:{id:crypto.randomUUID(), action:'sleep', status:'queued', expires_at:'2099-01-01T00:00:00Z'}});
  });
  await login(page,1);
  await page.locator('.dog-map-icon').click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Master 5');
  await expect(dialog.locator('.device-commands')).toContainText('Master 201');
  await expect(dialog.getByRole('button',{name:'要求開始追蹤',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'要求省電待機',exact:true}).click();
  expect(submitted[0].p_master_id).toBe(201);
  expect(submitted[0].p_slave_id).toBe(102);
});
test('Master 5 access alone does not grant control of Slave 102 through Master 201', async ({ page }) => {
  await mockCloud(page, false, 'relay-only');
  await login(page,1);
  await page.locator('.dog-map-icon').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.device-commands')).toHaveCount(0);
});

test('map distinguishes normal GPS, retained recent GPS and expired GPS', async ({page}) => {
  await mockCloud(page,true);
  const now=Date.now();
  const row=(id,slave,age,lat)=>({event_id:'00000000-0000-4000-8000-'+String(id).padStart(12,'0'),master_id:5,slave_id:slave,seq:id,received_at:new Date(now-age).toISOString(),
    payload:{lat,lon:lat?121565000:0,batteryPercentage:80,batteryValid:1},rssi:-70,snr:5});
  const rows=[row(101,4,5000,25033000),row(102,6,240000,25033500),row(103,6,5000,0),row(104,8,36*60000,25034000),row(105,8,5000,0)];
  await page.route('**/rest/v1/dog_telemetry*',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('or')?[]:rows}));
  await login(page,3);
  const normal=page.locator('.dog-map-icon[aria-label="狗 4"]');
  const retained=page.locator('.dog-map-icon[aria-label="狗 6"]');
  const expired=page.locator('.dog-map-icon[aria-label="狗 8"]');
  await expect(normal).not.toHaveClass(/dog-map-stale|dog-map-retained/);
  await expect(retained).toHaveClass(/dog-map-retained/);
  await expect(retained.locator('.dog-stale-cross')).toHaveCount(0);
  await expect(retained.locator('.dog-retained-warning')).toHaveText('!');
  await expect(page.locator('.dog-map-label').filter({hasText:'狗 6'})).toContainText('顯示最後有效位置');
  await expect(expired.locator('.dog-stale-cross')).toHaveText('×');
  await page.setViewportSize({width:390,height:844});
  await expect(retained).toBeVisible();
});

test('Slave 108 detail controls send through Master 201 independently of telemetry source', async ({page}) => {
 await mockCloud(page,false,'relay');
 const at=new Date().toISOString();
 const row={event_id:'00000000-0000-4000-8000-000000000108',master_id:5,slave_id:108,seq:108,received_at:at,
   payload:{lat:25033000,lon:121565000,batteryPercentage:80,batteryValid:1},rssi:-80,snr:5};
 await page.route('**/rest/v1/dog_telemetry*',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('or')?[]:[row]}));
 const submissions=[];
 await page.route('**/rest/v1/rpc/create_device_command',async route=>{
  submissions.push(route.request().postDataJSON());
  await route.fulfill({json:{id:crypto.randomUUID(),action:'tracking',slave_id:108,status:'queued',expires_at:'2099-01-01T00:00:00Z'}});
 });
 await login(page,1);await page.locator('.dog-map-icon').click();
 const control=page.getByRole('region',{name:'Slave 108 遠端控制'});
 await expect(control).toContainText('Master 201');
 await control.getByRole('button',{name:'要求開始追蹤',exact:true}).click();
 expect(submissions[0].p_slave_id).toBe(108);expect(submissions[0].p_master_id).toBe(201);
});

test('Slave 104 detail controls send through Master 201 independently of telemetry source', async ({page}) => {
 await mockCloud(page,false,'relay');
 const at=new Date().toISOString();
 const row={event_id:'00000000-0000-4000-8000-000000000104',master_id:5,slave_id:104,seq:104,received_at:at,
   payload:{lat:25033000,lon:121565000,batteryPercentage:80,batteryValid:1},rssi:-80,snr:5};
 await page.route('**/rest/v1/dog_telemetry*',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('or')?[]:[row]}));
 const submissions=[];
 await page.route('**/rest/v1/rpc/create_device_command',async route=>{
  submissions.push(route.request().postDataJSON());
  await route.fulfill({json:{id:crypto.randomUUID(),action:'tracking',slave_id:104,status:'queued',expires_at:'2099-01-01T00:00:00Z'}});
 });
 await login(page,1);await page.locator('.dog-map-icon').click();
 const control=page.getByRole('region',{name:'Slave 104 遠端控制'});
 await expect(control).toContainText('Master 201');
 await control.getByRole('button',{name:'要求開始追蹤',exact:true}).click();
 expect(submissions[0].p_slave_id).toBe(104);expect(submissions[0].p_master_id).toBe(201);
});

test('relayed Slave 108 shows the same confirmed mode on map and detail', async ({ page }) => {
  await mockCloud(page, false, 'relay');
  const at = new Date().toISOString();
  const row = { event_id: '00000000-0000-4000-8000-000000000108', master_id: 7, slave_id: 108,
    received_at: at, payload: { lat: 25033000, lon: 121565000, batteryPercentage: 70, batteryValid: 1 }, rssi: -12 };
  await page.route('**/rest/v1/device_members*', route => route.fulfill({ json:
    Number(new URL(route.request().url()).searchParams.get('offset')) > 0 ? [] : [{ gateway_id: 'master_201' }, { gateway_id: 'master_7' }] }));
  await page.route('**/rest/v1/dog_telemetry*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('or') ? [] : [row] }));
  let mode = 0;
  const targets = [];
  await page.route('**/rest/v1/device_commands*', route => {
    const params = new URL(route.request().url()).searchParams;
    targets.push([params.get('master_id'), params.get('slave_id')]);
    return route.fulfill({ json: params.get('master_id') === 'eq.201' && params.get('slave_id') === 'eq.108' ? [{
      id: 'confirmed-108', master_id: 201, slave_id: 108, action: mode ? 'tracking' : 'sleep',
      status: 'confirmed', reported_mode: mode, created_at: at, completed_at: at,
    }] : [] });
  });
  await login(page, 1);
  await expect(page.locator('.dog-map-label')).toContainText('裝置模式：省電待機');
  await expect(page.locator('.dog-map-label')).toContainText('RSSI：-12 dBm');
  await page.locator('.dog-map-icon').click();
  await expect(page.getByRole('dialog')).toContainText('來源：經 Master 7');
  await expect(page.locator('.device-mode')).toContainText('省電待機');
  mode = 1;
  await expect(page.locator('.device-mode')).toContainText('追蹤中', { timeout: 10000 });
  await page.getByRole('button', { name: '關閉詳細資訊' }).click();
  await expect(page.locator('.dog-map-label')).toContainText('裝置模式：追蹤中', { timeout: 10000 });
  expect(targets.every(([master, slave]) => master === 'eq.201' && slave === 'eq.108')).toBe(true);
});
