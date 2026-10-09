import { test, expect } from '@playwright/test';

const owner = '00000000-0000-4000-8000-000000000010';
async function mockCloud(page) {
  const now = Date.now();
  const user = { id: owner, email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date(now).toISOString() };
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp: Math.floor(now / 1000) + 3600 })).toString('base64url')}.test_signature`;
  const packet = (id, slave, ago, lat = 25033000) => ({
    event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    master_id: 5, slave_id: slave, seq: id, received_at: new Date(now - ago).toISOString(),
    payload: { lat, lon: 121565000, speed: 1250, hdop: 150, satellites: 9, batteryPercentage: 82,
      batteryValid: 1, activityScore: 650, activityValid: 1, usbPresent: 0 }, rssi: -91, snr: 5,
  });
  const rows = [packet(1, 2, 45000), packet(2, 2, 15000, 25033200), packet(3, 9, 240000)];
  const requested = [];
  await page.route('http://127.0.0.1:54321/**', async route => {
    const url = new URL(route.request().url()); requested.push(url.pathname);
    let body = {};
    if (url.pathname.endsWith('/token')) body = { access_token: token, refresh_token: 'test_refresh_token', token_type: 'bearer', expires_in: 3600, user };
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.endsWith('/logout')) body = {};
    else if (url.pathname.endsWith('/device_members')) body = Number(url.searchParams.get('offset')) > 0 ? [] : [{ gateway_id: 'master_5', slave_id: null }];
    else if (url.pathname.endsWith('/dog_telemetry')) body = url.searchParams.has('or') ? [] : rows;
    else if (url.pathname.endsWith('/slave_fixed_locations')) body = [];
    else if (url.pathname.endsWith('/unlock-fixed-location')) return route.fulfill({ status: 403, json: { error: 'Invalid password' } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return requested;
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('密碼', { exact: true }).fill('test_password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '犬隻即時追蹤' })).toBeVisible();
  await expect(page.locator('.dog-card')).toHaveCount(2);
}

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
  await expect(page.locator('.dog-map-icon')).toHaveCount(1);
  const dog = page.locator('.dog-card').filter({ hasText: '狗 2' });
  await expect(dog).toContainText('12.5'); await expect(dog).toContainText('82%');
  await dog.getByRole('button', { name: '地圖跟隨', exact: true }).click();
  await expect(dog).toContainText('取消跟隨');
  await dog.getByRole('button', { name: '隱藏狗 2位置' }).click();
  await expect(page.locator('.dog-map-icon')).toHaveCount(0);
  await dog.getByRole('button', { name: '顯示狗 2位置' }).click();
  await expect(page.locator('.dog-map-icon')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/slave-desktop.png', fullPage: true });
  await dog.locator('.dog-title').click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('-91 dBm'); await expect(dialog).toContainText('過去 24 小時活動量');
  await dialog.getByRole('button', { name: '修改設定' }).click();
  await dialog.getByLabel('帳號密碼', { exact: true }).fill('incorrect_test_password');
  await dialog.getByRole('button', { name: '解鎖', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('無法解鎖');
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
  expect((await downloadPromise).suggestedFilename()).toMatch(/DogTracker.*\.csv$/);
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登入 DogTracker' })).toBeVisible();
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
