import { test, expect } from '@playwright/test';

test('production manifest, icons and active Service Worker', async ({ page }) => {
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  const manifestURL = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifest = await (await page.request.get(manifestURL)).json();
  expect(manifest.name).toBe('DogWebTracker');
  expect(manifest.short_name).toBe('DogWebTracker');
  expect(manifest.display).toBe('standalone'); expect(manifest.start_url).toBe('/'); expect(manifest.scope).toBe('/');
  expect(manifest.icons.some(icon => icon.purpose === 'maskable' && icon.sizes === '512x512')).toBe(true);
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src); expect(response.ok()).toBe(true);
    expect((await response.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key =>
    (await (await caches.open(key)).keys()).map(request => request.url)))).flat());
  expect(cached.some(url => url.includes('/index.html'))).toBe(true);
  expect(cached.some(url => url.includes('/assets/'))).toBe(true);
  expect(cached.some(url => /supabase\.co|\/auth\/v1|\/rest\/v1|tile\.openstreetmap/.test(url))).toBe(false);
  expect(failures).toEqual([]);
});

test('offline reload opens cached app with truthful offline notice', async ({ page, context }) => {
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  await page.goto('/'); await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '登入 DogWebTracker' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '離線中' })).toBeVisible();
  await page.goto('/offline-navigation-check', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '登入 DogWebTracker' })).toBeVisible();
  const apiResponse = await page.evaluate(async () => {
    try { const response = await fetch('/api/offline-check'); return response.headers.get('content-type'); }
    catch { return 'network-failure'; }
  });
  expect(apiResponse).not.toContain('text/html');
  await page.screenshot({ path: 'test-results/pwa-offline.png', fullPage: true });
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: '離線中' })).not.toBeVisible();
  expect(failures).toEqual([]);
});

test('installation entry handles browser prompt and removes itself after installation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(event);
  });
  const install = page.getByRole('button', { name: '＋ 安裝 DogWebTracker' });
  await expect(install).toBeVisible(); await install.click();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(install).not.toBeVisible();
});
