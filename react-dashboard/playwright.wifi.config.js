import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Dedicated port keeps Wi-Fi tests separate from an existing development server.
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5186' },
  webServer: { ...base.webServer,
    command: 'npm run dev -- --host 127.0.0.1 --port 5186 --strictPort',
    url: 'http://127.0.0.1:5186', reuseExistingServer: false,
  },
});
