const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // One worker — tests share a local server and some interact with localStorage;
  // parallel runs would interfere with each other.
  workers: 1,
  use: {
    baseURL: 'http://localhost:3001',
    // Use system Chrome — Playwright's bundled Chromium doesn't support macOS 12.
    channel: 'chrome',
    headless: true,
    // CSP hashes in the source file go stale after any script edit (the deploy
    // pipeline updates them, but tests serve the source directly). bypassCSP
    // disables enforcement so tests always run against the current code.
    bypassCSP: true,
  },
  webServer: {
    command: 'python3 -m http.server 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
  },
});
