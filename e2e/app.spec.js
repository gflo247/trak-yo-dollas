// e2e/app.spec.js — browser-level invariant tests
// Run with: npm run test:e2e
// Each test gets an isolated browser context (empty localStorage).

const { test, expect } = require('@playwright/test');
const path = require('path');

const SAMPLE_CSV = path.join(__dirname, 'fixtures/sample.csv');
const APP = '/trakyodollas.html';

// Load a demo profile. The demo picker auto-opens after an 80ms timer on a
// fresh page, but in headless Chrome the overlay may not become visible in
// time. Calling openDemoPicker() directly after the page is ready is reliable.
async function loadDemo(page, profile = '1') {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openDemoPicker === 'function');
  await page.evaluate(() => openDemoPicker(true));
  await page.locator(`[data-action="loadDemoProfile"][data-arg="${profile}"]`).waitFor({ state: 'visible' });
  await page.locator(`[data-action="loadDemoProfile"][data-arg="${profile}"]`).click();
  // Spending tab nav button is a reliable "app is ready" signal.
  await page.locator('[data-action="showPageSpending"]').waitFor({ state: 'visible' });
}

// Import the sample CSV over whatever data is currently loaded.
async function importCSV(page) {
  await page.locator('#toolbar-import-btn').click();
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(SAMPLE_CSV);
  // Confirm button is hidden until the CSV parses successfully.
  await page.locator('#import-confirm-btn').waitFor({ state: 'visible' });
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });
}

// ─── Test 1: cushion stays constant while biz filter changes ─────────────────
// Verifies that avgTotalMonthlySpend() ignores _bizFilter.
// This was the bug class that took three adversarial passes to fully close;
// the test locks the invariant so it can't silently regress.
//
// The biz filter UI (#biz-filter-inline) is only shown when includeIncome is
// on, but the invariant is about the function call, not UI discoverability.
// Calling setBizFilter() via evaluate is the right scope for this test.
test('cushion is unaffected by the biz filter', async ({ page }) => {
  await loadDemo(page);

  // Navigate to Net Worth tab and wait for the cushion widget to render.
  await page.locator('[data-action="showPageDashboard"]').click();
  await expect(page.locator('#nw-runway-card')).toContainText('Cushion:');

  const cushionText = await page.locator('#nw-runway-card').textContent();
  const m = cushionText.match(/Cushion:\s*(.+?)\s*of expenses/);
  expect(m).not.toBeNull();
  const cushionValue = m[1].trim(); // e.g. "5mo+" or "2y 3mo+"

  for (const filter of ['biz', 'personal', 'all']) {
    // setBizFilter() calls renderAll() internally, so #nw-runway-card re-renders.
    await page.evaluate((f) => setBizFilter(f), filter);
    await expect(page.locator('#nw-runway-card')).toContainText(cushionValue);
  }
});

// ─── Test 2: import → reload round-trip ──────────────────────────────────────
// Verifies that imported transactions survive a full page reload (localStorage
// persistence). Catches the class of bug where data appears to save but the
// serialization or deserialization path is broken.
test('imported transactions survive a page reload', async ({ page }) => {
  await loadDemo(page);
  await importCSV(page);

  const countBefore = await page.evaluate(() => state.transactions.length);
  expect(countBefore).toBeGreaterThan(0);

  // Reload — app re-initializes from localStorage, no demo picker (hasRealData=true).
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.transactions.length > 0);

  const countAfter = await page.evaluate(() => state.transactions.length);
  expect(countAfter).toBe(countBefore);
});

// ─── Test 3: backup round-trip ────────────────────────────────────────────────
// Verifies that exporting a backup and re-importing it restores the same
// transaction count. Catches serialization bugs in exportBackup()/importBackup().
test('backup export and re-import restores the same data', async ({ page }) => {
  await loadDemo(page);

  const countBefore = await page.evaluate(() => state.transactions.length);
  expect(countBefore).toBeGreaterThan(0);

  // Export backup.
  await page.locator('#global-settings-btn').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="exportBackup|closeGlobalSettings"]').click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  // Wipe localStorage and reload to a clean state.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Set the backup file directly on the hidden input — bypasses the settings
  // menu and the demo picker overlay that auto-opens on a fresh page.
  await page.locator('#backup-file-input').setInputFiles(backupPath);
  await page.waitForFunction(
    (n) => typeof state !== 'undefined' && state.transactions.length === n,
    countBefore,
  );

  const countAfter = await page.evaluate(() => state.transactions.length);
  expect(countAfter).toBe(countBefore);
});

// ─── Test 4: demo-to-real switch ─────────────────────────────────────────────
// Verifies that importing real CSV data while on a demo session correctly
// clears the demo markers (nudge banner and nav badge).
test('importing real data dismisses the demo markers', async ({ page }) => {
  await loadDemo(page);

  // Demo markers must be visible before the switch.
  await expect(page.locator('#demo-nudge')).toBeVisible();
  await expect(page.locator('#demo-nav-badge')).toBeVisible();

  await importCSV(page);

  // Both markers must disappear after the first real import.
  await expect(page.locator('#demo-nudge')).toBeHidden();
  await expect(page.locator('#demo-nav-badge')).toBeHidden();
});
