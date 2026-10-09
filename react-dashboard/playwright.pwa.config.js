import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testDir: './tests/pwa',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5176', serviceWorkers: 'allow' },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
  },
});
