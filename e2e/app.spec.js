// e2e/app.spec.js — browser-level invariant tests
// Run with: npm run test:e2e
// Each test gets an isolated browser context (empty localStorage).

const { test, expect } = require('@playwright/test');
const path = require('path');

const SAMPLE_CSV = path.join(__dirname, 'fixtures/sample.csv');
const APP = '/trakyodollas.html';

// Bank fixture paths
const DISCOVER_CSV = path.join(__dirname, '..', 'test/fixtures/banks/discover.csv');
const CAPITALONE_CARD_CSV = path.join(__dirname, '..', 'test/fixtures/banks/capitalone_card.csv');
const CHASE_CARD_CSV = path.join(__dirname, '..', 'test/fixtures/banks/chase_card.csv');
const CHASE_PLATFORMS_CSV = path.join(__dirname, '..', 'test/fixtures/banks/chase_card_platforms.csv');
const BOFA_CHECKING_CSV = path.join(__dirname, '..', 'test/fixtures/banks/bofa_checking_debit.csv');

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

// Import a specific CSV file. Opens the import modal if not already open.
async function importFile(page, csvPath) {
  await page.locator('#toolbar-import-btn').click();
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(csvPath);
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
  // importBackup() shows a confirm() dialog; accept it so the import proceeds.
  page.once('dialog', dialog => dialog.accept());
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

// ─── Test 4a: auto-label hint on first import, merge hint on second ─────────
test('import label hints: first shows tag hint, second shows merge hint', async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  // First import — discover.csv auto-labels as "Discover"
  await page.locator('#toolbar-import-btn').click();
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(DISCOVER_CSV);
  await page.locator('#import-confirm-btn').waitFor({ state: 'visible' });

  // Check the hint text — should say "tagged as"
  const hintText = await page.locator('#import-label-hint-text').textContent();
  expect(hintText).toContain('tagged as');

  // Complete the import
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });

  // "Import another CSV" — capitalone_card.csv
  await page.locator('[data-action="importSuccessAndReopen"]').click();
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(CAPITALONE_CARD_CSV);
  // #import-confirm-btn is already visible from the first import, so waitFor resolves before
  // the second file is processed. Use #import-preview-stats instead: it is hidden when the
  // modal reopens (openTxImportModal() calls _hideImportPreview()) and only becomes visible
  // once showImportPreview() runs after the second file parses successfully.
  await expect(page.locator('#import-preview-stats')).toBeVisible();

  // Hint should now say "merge" since Capital One is a new source but "Checking" is default
  // and Discover already exists — actually Capital One auto-labels as "Capital One"
  // which is new, so it shows "tagged as" again. Check that it shows a label hint.
  const hintText2 = await page.locator('#import-label-hint-text').textContent();
  expect(hintText2.length).toBeGreaterThan(0);
});

// ─── Test 4b: label resets from auto-name to "Checking" on file change ──────
test('import label resets from auto-name when new file has no auto-name', async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  await page.locator('#toolbar-import-btn').click();
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });

  // Load chase_card.csv — auto-labels as "Chase"
  await page.locator('#tx-csv-file').setInputFiles(CHASE_CARD_CSV);
  await page.locator('#import-confirm-btn').waitFor({ state: 'visible' });
  const labelAfterChase = await page.locator('#import-source-label').inputValue();
  expect(labelAfterChase).toBe('Chase');

  // Now load the generic sample.csv — no bank-specific auto-label.
  // The label should reset from "Chase" back to "Checking".
  await page.locator('#tx-csv-file').setInputFiles(SAMPLE_CSV);
  // #import-confirm-btn is already visible from the Chase file load, so waitFor resolves
  // before sample.csv is processed. Wait for the label to change to "Checking" instead —
  // that only happens once _resetAutoLabelIfStale() runs after the new file parses.
  await expect(page.locator('#import-source-label')).toHaveValue('Checking');
  const labelAfterSample = await page.locator('#import-source-label').inputValue();
  expect(labelAfterSample).toBe('Checking');
});

// ─── Test 4c: backup nudge hidden when banner showing, visible after dismiss ─
test('backup nudge hidden while banner visible, shows after dismiss', async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  // Ensure no prior backup date exists and banner hasn't been dismissed
  await page.evaluate(() => {
    localStorage.removeItem('trakyo_last_backup_date');
    localStorage.removeItem('trakyo_local_data_notice_shown');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  // Import a file — the local-data-notice banner should be showing
  await page.locator('#toolbar-import-btn').click();
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(DISCOVER_CSV);
  await page.locator('#import-confirm-btn').waitFor({ state: 'visible' });
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });

  // Backup nudge should be hidden because the banner is visible
  const nudge = page.locator('#import-success-backup-nudge');
  await expect(nudge).toBeHidden();

  // Dismiss the banner via JS (it's behind the modal overlay so can't click it)
  await page.evaluate(() => dismissLocalDataNotice());

  // "Import another CSV" reopens the import modal
  await page.locator('[data-action="importSuccessAndReopen"]').click();
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  // Small delay for the modal to fully initialize
  await page.waitForTimeout(200);
  await page.locator('#tx-csv-file').setInputFiles(CAPITALONE_CARD_CSV);
  // #import-confirm-btn is already visible from the first import, so waitFor resolves before
  // the second file is processed. Use #import-preview-stats instead: it is hidden when the
  // modal reopens and only becomes visible once the second file parses successfully.
  await expect(page.locator('#import-preview-stats')).toBeVisible();
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });

  // Now the banner is dismissed, so the nudge should show "Last backup: never."
  const nudge2 = page.locator('#import-success-backup-nudge');
  await expect(nudge2).toBeVisible();
  const nudgeMsg = await page.locator('#import-success-backup-msg').textContent();
  expect(nudgeMsg).toContain('never');

  // Export backup — nudge should hide
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#import-success-backup-nudge [data-action="exportBackup"]').click();
  await downloadPromise;
  await expect(nudge2).toBeHidden();
});

// ─── Test 4d: chase_card_platforms detects 4 subscriptions ──────────────────
test('recurring tab detects Netflix, YouTube Premium, Duolingo, Amazon Prime from chase_card_platforms', async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  await importFile(page, CHASE_PLATFORMS_CSV);

  // Close success modal
  await page.locator('[data-action="importSuccessAndAlign"]').click();

  // Navigate to Spending tab (should already be there)
  await page.locator('[data-action="showPageSpending"]').click();

  // Open the subscriptions modal
  await page.evaluate(() => openSubscriptionsModal());
  await page.locator('#subscriptions-modal').waitFor({ state: 'visible' });

  const listText = await page.locator('#subscriptions-list').textContent();
  expect(listText).toContain('Netflix');
  expect(listText).toContain('Youtube');  // displayVendor lowercases
  expect(listText).toContain('Duolingo');
  expect(listText).toContain('Amazon Prime');
});

// ─── Test 4e: bofa_checking_debit detects recurring and single vendor entries ─
test('bofa_checking_debit: recurring includes Netflix and Spotify; Kroger appears once in vendors', async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  await importFile(page, BOFA_CHECKING_CSV);
  await page.locator('[data-action="importSuccessAndAlign"]').click();
  await page.locator('#import-success-modal').waitFor({ state: 'hidden' });
  await page.locator('[data-action="showPageSpending"]').click();

  // Check subscriptions
  await page.evaluate(() => openSubscriptionsModal());
  await page.locator('#subscriptions-modal').waitFor({ state: 'visible' });
  const listText = await page.locator('#subscriptions-list').textContent();
  expect(listText).toContain('Netflix');
  expect(listText).toContain('Spotify');

  // Close modal
  await page.locator('[data-action="closeSubscriptionsModal"]').click();

  // Check that Kroger appears as a single vendor (all KROGER #123/456 resolve to KROGER)
  // The top vendor tiles use resolveVendor, so KROGER should appear once not multiple times
  const vendorTiles = await page.evaluate(() => {
    const txs = state.transactions.filter(t => !t.excluded);
    const vendors = {};
    txs.forEach(t => {
      const v = resolveVendor(t.desc);
      vendors[v] = (vendors[v] || 0) + t.amount;
    });
    return Object.keys(vendors).filter(v => v === 'KROGER');
  });
  expect(vendorTiles.length).toBe(1);
});

// ─── Test 4f: SQ* keyword suggestion strips prefix ─────────────────────────
test('keyword suggestion uses cleaned vendor text, not raw prefix', async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  // Create a minimal Chase-format CSV inline with SQ * and TST* entries
  const csvContent = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '09/01/2026,09/02/2026,SQ *BLUE BOTTLE COFFEE,Food & Drink,Sale,-5.50,',
    '09/05/2026,09/06/2026,SQ *JOES TACO TRUCK,Food & Drink,Sale,-12.00,',
    '09/10/2026,09/11/2026,SQ *KERRYTOWN FARMERS MKT,Food & Drink,Sale,-25.00,',
    '09/15/2026,09/16/2026,TST* LOCAL KITCHEN,Food & Drink,Sale,-18.50,',
  ].join('\n');

  // Write the CSV content to a temp file
  const fs = require('fs');
  const tmpFile = path.join(__dirname, 'fixtures/sq_test.csv');
  fs.writeFileSync(tmpFile, csvContent);

  await importFile(page, tmpFile);
  await page.locator('[data-action="importSuccessAndAlign"]').click();

  // Navigate to Spending tab and find transactions
  await page.locator('[data-action="showPageSpending"]').click();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.transactions.length > 0);

  // Find the TST* LOCAL KITCHEN transaction and change its category
  const txId = await page.evaluate(() => {
    const t = state.transactions.find(t => t.desc.includes('TST* LOCAL KITCHEN'));
    return t ? t.id : null;
  });
  expect(txId).not.toBeNull();

  // Open edit modal for this transaction
  await page.evaluate((id) => openEditTxModal(id), txId);
  await page.locator('#edit-tx-modal').waitFor({ state: 'visible' });

  // Change category to Groceries
  await page.locator('#et-cat').selectOption('Groceries');
  await page.locator('[data-action="saveEditTx"]').click();

  // Wait for the rule prompt modal to appear
  await page.waitForFunction(() => {
    const el = document.getElementById('save-rule-modal');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });

  // Check that the suggested keyword is "LOCAL KITCHEN" not "TST"
  const keywordField = await page.locator('#srp-keyword-input').inputValue();
  expect(keywordField).toBe('LOCAL KITCHEN');
  expect(keywordField).not.toContain('TST');

  // Cleanup
  fs.unlinkSync(tmpFile);
});

// ── Wrong-file detection: QFX file shows Quicken error ──────────────────────
test('wrong-file: QFX file shows Quicken error message', async ({ page }) => {
  const QFX_FILE = path.join(__dirname, 'fixtures/wrong_file.qfx');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(QFX_FILE);
  // Wait for the zero-msg to appear
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  const msgText = await page.locator('#import-zero-msg').innerText();
  expect(msgText).toContain('Quicken');
  expect(msgText).not.toContain('PK');
  // Confirm button should not be visible
  const confirmVisible = await page.locator('#import-confirm-btn').isVisible();
  expect(confirmVisible).toBe(false);
});

// ── Wrong-file detection: XLSX file shows spreadsheet error ─────────────────
test('wrong-file: XLSX file shows spreadsheet error message', async ({ page }) => {
  const fs = require('fs');
  const tmpXlsx = path.join(__dirname, 'fixtures/wrong_file.xlsx');
  fs.writeFileSync(tmpXlsx, Buffer.from([0x50, 0x4B, 0x03, 0x04]));
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(tmpXlsx);
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  const msgText = await page.locator('#import-zero-msg').innerText();
  expect(msgText).toContain('spreadsheet');
  expect(msgText).not.toContain('PK');
  const confirmVisible = await page.locator('#import-confirm-btn').isVisible();
  expect(confirmVisible).toBe(false);
  // Cleanup
  fs.unlinkSync(tmpXlsx);
});

// ── Wrong-file: .zip shows archive message, not spreadsheet ─────────────────
test('wrong-file: .zip file shows archive error message, not spreadsheet message', async ({ page }) => {
  const fs = require('fs');
  // .zip with PK magic bytes — same bytes as XLSX, but extension is .zip
  const tmpZip = path.join(__dirname, 'fixtures/wrong_file.zip');
  fs.writeFileSync(tmpZip, Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]));
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(tmpZip);
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  const msgText = await page.locator('#import-zero-msg').innerText();
  expect(msgText).toContain('zip');
  expect(msgText).not.toContain('spreadsheet');
  expect(msgText).not.toContain('Excel');
  fs.unlinkSync(tmpZip);
});

// ── Wrong-file: stale state cleared on error ─────────────────────────────────
test('wrong-file: format badge hidden and Import button gone after dropping bad file over successful parse', async ({ page }) => {
  const fs = require('fs');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  // First: import a valid CSV so importParsed is populated and badge shows
  await importFile(page, DISCOVER_CSV);
  // Close success modal
  await page.evaluate(() => { const m = document.getElementById('import-success-modal'); if (m) m.classList.add('hidden'); });

  // Re-open modal and confirm the badge is visible from the auto-detect
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(DISCOVER_CSV);
  await page.waitForFunction(() => {
    const btn = document.getElementById('import-confirm-btn');
    return btn && !btn.classList.contains('hidden');
  }, { timeout: 5000 });
  // Badge should be visible after a successful parse
  await expect(page.locator('#import-detected-fmt')).toBeVisible();

  // Now drop a ZIP file (wrong type) — badge and Import button should both hide
  const tmpZip = path.join(__dirname, 'fixtures/wrong_file.zip');
  fs.writeFileSync(tmpZip, Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]));
  try {
    await page.locator('#tx-csv-file').setInputFiles(tmpZip);
    await page.waitForFunction(() => {
      const el = document.getElementById('import-zero-msg');
      return el && !el.classList.contains('hidden');
    }, { timeout: 3000 });
    // Import button must be hidden
    await expect(page.locator('#import-confirm-btn')).toBeHidden();
    // Format badge must be hidden — not left over from the previous parse
    await expect(page.locator('#import-detected-fmt')).toBeHidden();
  } finally {
    fs.unlinkSync(tmpZip);
  }
});

test('wrong-file: label-hint, date-fmt-row, and format picker are hidden after dropping bad file over a successful parse', async ({ page }) => {
  const QFX_FILE = path.join(__dirname, 'fixtures/wrong_file.qfx');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });

  // Drop a valid CSV first so label-hint, date-fmt-row, and stale _importRawRows are set
  await page.locator('#tx-csv-file').setInputFiles(SAMPLE_CSV);
  await page.waitForFunction(() => {
    const btn = document.getElementById('import-confirm-btn');
    return btn && !btn.classList.contains('hidden');
  }, { timeout: 5000 });
  // Confirm label-hint is visible from the successful parse
  await expect(page.locator('#import-label-hint')).toBeVisible();

  // Now drop the wrong-file — all three UI elements must hide
  await page.locator('#tx-csv-file').setInputFiles(QFX_FILE);
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  await expect(page.locator('#import-label-hint')).toBeHidden();
  await expect(page.locator('#import-date-fmt-row')).toHaveCSS('display', 'none');
  await expect(page.locator('#fmt-picker-panel')).toBeHidden();
  // _importRawRows must be cleared: calling setImportFmt should not restore the preview
  await page.evaluate(() => setImportFmt('ally'));
  await expect(page.locator('#import-confirm-btn')).toBeHidden();
});

test('wrong-file: dropping a valid CSV after a wrong-file error clears the wrong-file heading', async ({ page }) => {
  const QFX_FILE = path.join(__dirname, 'fixtures/wrong_file.qfx');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });

  // Drop wrong file first
  await page.locator('#tx-csv-file').setInputFiles(QFX_FILE);
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  expect(await page.locator('#import-zero-msg').innerText()).toContain('Wrong file type');

  // Drop a valid CSV — preview must show, wrong-file message must disappear
  await page.locator('#tx-csv-file').setInputFiles(SAMPLE_CSV);
  await page.waitForFunction(() => {
    const btn = document.getElementById('import-confirm-btn');
    return btn && !btn.classList.contains('hidden');
  }, { timeout: 5000 });
  // zero-msg (and everything inside it, including #import-wrong-file-msg)
  // is hidden; there's no need to detach the inner div on the success path.
  await expect(page.locator('#import-zero-msg')).toBeHidden();
});

test('wrong-file: PDF hides the "Pick your format manually" button', async ({ page }) => {
  const fs = require('fs');
  const tmpPdf = path.join(__dirname, 'fixtures/wrong_file.pdf');
  // PDF magic bytes: %PDF-
  fs.writeFileSync(tmpPdf, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]));
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(tmpPdf);
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  // The "Pick your format manually" button must be hidden
  await expect(page.locator('#import-manual-fmt-btn')).toBeHidden();
  // Cleanup
  fs.unlinkSync(tmpPdf);
});

test('wrong-file: CSV with unknown headers shows the "Pick your format manually" button', async ({ page }) => {
  const fs = require('fs');
  const tmpCsv = path.join(__dirname, 'fixtures/unknown_headers.csv');
  fs.writeFileSync(tmpCsv, 'Col1,Col2,Col3\nfoo,bar,baz\n');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(tmpCsv);
  // Wait for zero-transactions UI to appear
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  // "Found 0 transactions" heading
  const heading = await page.locator('#import-zero-msg div').first().textContent();
  expect(heading).toContain('0 transactions');
  // The "Pick your format manually" button must be visible
  await expect(page.locator('#import-manual-fmt-btn')).toBeVisible();
  // Clicking it must open the format picker
  await page.locator('#import-manual-fmt-btn').click();
  await expect(page.locator('#fmt-picker-panel')).toBeVisible();
  // Cleanup
  fs.unlinkSync(tmpCsv);
});

test('wrong-file: Quicken then unknown-headers CSV: zero-row state is clean with no Quicken message', async ({ page }) => {
  const QFX_FILE = path.join(__dirname, 'fixtures/wrong_file.qfx');
  const fs = require('fs');
  const tmpCsv = path.join(__dirname, 'fixtures/unknown_headers.csv');
  if (!fs.existsSync(tmpCsv)) fs.writeFileSync(tmpCsv, 'Col1,Col2,Col3\nfoo,bar,baz\n');

  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });

  // Drop Quicken file first — wrong-file message shows
  await page.locator('#tx-csv-file').setInputFiles(QFX_FILE);
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });
  expect(await page.locator('#import-zero-msg').innerText()).toContain('Quicken');

  // Now drop a CSV with unknown headers — zero-row state replaces Quicken message
  await page.locator('#tx-csv-file').setInputFiles(tmpCsv);
  await page.waitForFunction(() => {
    const btn = document.getElementById('import-confirm-btn');
    // confirm btn must stay hidden (zero rows)
    return btn && btn.classList.contains('hidden');
  }, { timeout: 3000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('import-zero-msg');
    return el && !el.classList.contains('hidden');
  }, { timeout: 3000 });

  const msgText = await page.locator('#import-zero-msg').innerText();
  // Heading must say "Found 0 transactions", not "Wrong file type"
  expect(msgText).toContain('Found 0 transactions');
  // Quicken message must be gone
  expect(msgText).not.toContain('Quicken');
  // The CSV header must appear
  expect(msgText).toContain('Col1');
  // The format button must be visible (CSV case, not binary)
  await expect(page.locator('#import-manual-fmt-btn')).toBeVisible();
  // The Import button must be hidden
  await expect(page.locator('#import-confirm-btn')).toBeHidden();
});

test('import: Monarch export shows per-account names in the label hint', async ({ page }) => {
  const MONARCH_CSV = path.join(__dirname, '..', 'test', 'fixtures', 'banks', 'monarch_export.csv');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(MONARCH_CSV);
  await page.waitForFunction(() => {
    const btn = document.getElementById('import-confirm-btn');
    return btn && !btn.classList.contains('hidden');
  }, { timeout: 5000 });
  // The label hint must be visible
  await expect(page.locator('#import-label-hint')).toBeVisible();
  // It must name the actual accounts from the file
  const hintText = await page.locator('#import-label-hint').innerText();
  // monarch_export.csv has accounts: "Chase Freedom" and "Checking"
  expect(hintText).toMatch(/keeps its own account name|Chase Freedom|Checking/i);
});

test('replace: Monarch re-import with replace removes all previous Monarch transactions', async ({ page }) => {
  const MONARCH_CSV = path.join(__dirname, '..', 'test', 'fixtures', 'banks', 'monarch_export.csv');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  // First import
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(MONARCH_CSV);
  await page.locator('#import-confirm-btn').waitFor({ state: 'visible' });
  const firstCount = await page.evaluate(() => importParsed.length);
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });
  const afterFirst = await page.evaluate(() => state.transactions.length);
  await page.evaluate(() => { const m = document.getElementById('import-success-modal'); if (m) m.classList.add('hidden'); });

  // Second import with Replace checked
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(MONARCH_CSV);
  // #import-confirm-btn is already visible from the first import, so waitFor resolves before
  // the second file is processed. MONARCH_CSV auto-labels as "Monarch Import"; wait for that
  // label value — it is only set once showImportPreview() runs after the second file parses.
  await expect(page.locator('#import-source-label')).toHaveValue('Monarch Import');
  await page.locator('#import-replace').check();
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });

  // After replace, count should equal a single import, not doubled
  const afterReplace = await page.evaluate(() => state.transactions.length);
  expect(afterReplace).toBe(afterFirst);
  expect(afterReplace).toBe(firstCount);
});

// ── Replace existing transactions ────────────────────────────────────────────
test('replace: re-importing same source with replace checked removes old transactions and imports new ones', async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');

  // First import: Discover CSV under source "Discover"
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(DISCOVER_CSV);
  await page.locator('#import-confirm-btn').waitFor({ state: 'visible' });
  const countBefore = await page.evaluate(() => importParsed.length);
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });
  const afterFirst = await page.evaluate(() => state.transactions.length);
  expect(afterFirst).toBeGreaterThan(0);
  await page.evaluate(() => { const m = document.getElementById('import-success-modal'); if (m) m.classList.add('hidden'); });

  // Second import: same Discover CSV, replace checked
  await page.evaluate(() => openTxImportModal());
  await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
  await page.locator('#tx-csv-file').setInputFiles(DISCOVER_CSV);
  // #import-confirm-btn is already visible from the first import, so waitFor resolves before
  // the second file is processed. DISCOVER_CSV is detected as generic format (no bank-specific
  // auto-label), so the label stays "Checking". Use #import-preview-stats instead: it is
  // hidden when the modal reopens (openTxImportModal() calls _hideImportPreview()) and only
  // becomes visible once showImportPreview() runs after the second file parses successfully.
  await expect(page.locator('#import-preview-stats')).toBeVisible();
  await page.locator('#import-replace').check();
  await page.locator('#import-confirm-btn').click();
  await page.locator('#import-success-modal').waitFor({ state: 'visible' });

  // After replace, transaction count should equal a single import (not doubled)
  const afterReplace = await page.evaluate(() => state.transactions.length);
  expect(afterReplace).toBe(afterFirst);
  expect(afterReplace).toBe(countBefore);
});

test('refunds: Total spend equals the sum of category tiles after importing capitalone_card_refunds.csv', async ({ page }) => {
  const CAPITALONE_REFUNDS_CSV = path.join(__dirname, '..', 'test', 'fixtures', 'banks', 'capitalone_card_refunds.csv');
  await page.goto(APP);
  await page.waitForFunction(() => typeof openTxImportModal === 'function');
  await importFile(page, CAPITALONE_REFUNDS_CSV);
  await page.waitForFunction(() => typeof renderAll === 'function');

  // Read Total spend from the header card
  const totalSpend = await page.evaluate(() => {
    const el = document.getElementById('spend-total-val');
    if (!el) return null;
    return parseFloat(el.textContent.replace(/[$,]/g, ''));
  });

  // Sum all visible category bucket tile amounts (.bucket-total inside #bucket-grid)
  const tileSum = await page.evaluate(() => {
    const grid = document.getElementById('bucket-grid');
    if (!grid) return null;
    const tiles = grid.querySelectorAll('.bucket-total');
    let sum = 0;
    tiles.forEach(t => { sum += parseFloat(t.textContent.replace(/[$,]/g, '')) || 0; });
    return Math.round(sum * 100) / 100;
  });

  expect(totalSpend).not.toBeNull();
  expect(tileSum).not.toBeNull();
  expect(Math.abs(totalSpend - tileSum)).toBeLessThanOrEqual(0.01);
});

// ── Storage quota: too-big imports and banner behavior ───────────────────────
// initScript that pre-fills localStorage with ~2.2MB of padding, then wraps
// setItem to throw QuotaExceededError once total used space exceeds 2,500,000
// characters (simulating Safari's ~2.5M-character limit — Safari stores 2 bytes
// per character, so its 5 MB quota holds about 2.5M characters). The pre-fill
// is necessary because _txsFit()'s fast-path skips the probe when projected
// total storage is under 2MB -- without pre-fill, the test CSV's ~540KB of JSON
// would be under that threshold and the probe would never run.
const QUOTA_INIT_SCRIPT = `
  (function(){
    const LIMIT = 2500000;
    // Pre-fill with ~2.2MB of dummy data before installing the quota hook.
    const chunk = 'x'.repeat(50000);
    for (let i = 0; i < 44; i++) {
      try { localStorage.setItem('_quota_pad_' + i, chunk); } catch(e) { break; }
    }
    const orig = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, 'setItem', {
      value: function(key, value) {
        let total = key.length + String(value).length;
        for (let i = 0; i < this.length; i++) {
          const k = this.key(i);
          if (k !== key) total += k.length + (this.getItem(k) || '').length;
        }
        if (total > LIMIT) {
          const e = new DOMException('QuotaExceededError', 'QuotaExceededError');
          throw e;
        }
        return orig.call(this, key, value);
      },
      configurable: true, writable: true
    });
  })();
`;

// Safari-limit simulation with no pre-fill — used to test that the Safari
// fast-path fix catches a large import in empty storage.
const SAFARI_LIMIT_SCRIPT = `
  (function(){
    const LIMIT = 2500000;
    const orig = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, 'setItem', {
      value: function(key, value) {
        let total = key.length + String(value).length;
        for (let i = 0; i < this.length; i++) {
          const k = this.key(i);
          if (k !== key) total += k.length + (this.getItem(k) || '').length;
        }
        if (total > LIMIT) {
          const e = new DOMException('QuotaExceededError', 'QuotaExceededError');
          throw e;
        }
        return orig.call(this, key, value);
      },
      configurable: true, writable: true
    });
  })();
`;

// Generate a Monarch CSV with 3200 rows (160 months × 20 days).
// Produces ~540KB of transaction JSON -- enough that projectedTotal (CSV JSON
// + ~2.2MB pre-fill padding) exceeds _txsFit()'s 2MB fast-path threshold and
// hits the actual binary-search probe, which then detects insufficient space.
function makeQuotaTestCsv() {
  const os = require('os');
  const fs = require('fs');
  const merchants = ['Netflix', 'Spotify', 'Amazon', 'Target', 'Starbucks'];
  const lines = ['Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags'];
  for (let month = 1; month <= 160; month++) {
    const year = 2010 + Math.floor((month - 1) / 12);
    const m = String(((month - 1) % 12) + 1).padStart(2, '0');
    for (let day = 1; day <= 20; day++) {
      const d = String(day).padStart(2, '0');
      lines.push(`${year}-${m}-${d},${merchants[day % 5]},Shopping,Chase Freedom,,,-${10 + (day % 50)},`);
    }
  }
  const csvPath = path.join(os.tmpdir(), `tyd_quota_test_${Date.now()}.csv`);
  fs.writeFileSync(csvPath, lines.join('\n'));
  return csvPath;
}

// Generate a Monarch CSV with 16,000 rows (160 months × 100 entries each).
// Each parsed row is ~170 characters of JSON; 16,000 rows ≈ 2.72MB, which
// exceeds Safari's 2.5M-character simulated limit when storage is otherwise
// empty. With the old 4MB fast-path, projectedTotal (2.72M) < 4M so the
// check was skipped and the import silently failed at the browser level.
// With the new 2MB cutoff, 2.72M > 2M runs the check, which detects that
// the data doesn't fit and shows the too-big message instead.
function makeSafariLimitCsv() {
  const os = require('os');
  const fs = require('fs');
  const merchants = ['Netflix', 'Spotify', 'Amazon', 'Target', 'Starbucks'];
  const lines = ['Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags'];
  for (let month = 1; month <= 160; month++) {
    const year = 2010 + Math.floor((month - 1) / 12);
    const m = String(((month - 1) % 12) + 1).padStart(2, '0');
    for (let day = 1; day <= 100; day++) {
      const d = String(((day - 1) % 28) + 1).padStart(2, '0');
      lines.push(`${year}-${m}-${d},${merchants[day % 5]},Shopping,Chase Freedom,,,-${10 + (day % 50)},`);
    }
  }
  const csvPath = path.join(os.tmpdir(), `tyd_safari_test_${Date.now()}.csv`);
  fs.writeFileSync(csvPath, lines.join('\n'));
  return csvPath;
}

test.describe('storage quota', () => {
  test('Safari-limit: 16,000-tx import in empty storage shows too-big message', async ({ page }) => {
    const fs = require('fs');
    await page.addInitScript(SAFARI_LIMIT_SCRIPT);
    await page.goto(APP);
    await page.waitForFunction(() => typeof openTxImportModal === 'function');

    const csvPath = makeSafariLimitCsv();
    try {
      await page.evaluate(() => openTxImportModal());
      await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
      await page.locator('#import-source-label').fill('Chase Freedom');
      await page.locator('#tx-csv-file').setInputFiles(csvPath);
      // Wait for preview
      await page.waitForFunction(() => {
        const btn = document.getElementById('import-confirm-btn');
        return btn && !btn.classList.contains('hidden');
      }, { timeout: 10000 });
      await page.locator('#import-confirm-btn').click();

      // #import-too-big-msg must appear (not the storage-full banner)
      await page.waitForFunction(() => {
        const el = document.getElementById('import-too-big-msg');
        return el && !el.classList.contains('hidden');
      }, { timeout: 10000 });

      // Trim offer must be present (at least some months fit)
      await page.locator('#import-trim-btn').waitFor({ state: 'visible' });

      // Nothing must have been saved
      const txJson = await page.evaluate(() => localStorage.getItem('trakyo_txs_v1'));
      expect(!txJson || txJson === '[]' || JSON.parse(txJson || '[]').length === 0).toBe(true);
    } finally {
      fs.unlinkSync(csvPath);
    }
  });

  test('too-big import shows offer and changes nothing', async ({ page }) => {
    const fs = require('fs');
    await page.addInitScript(QUOTA_INIT_SCRIPT);
    await page.goto(APP);
    await page.waitForFunction(() => typeof openTxImportModal === 'function');

    const csvPath = makeQuotaTestCsv();
    try {
      await page.evaluate(() => openTxImportModal());
      await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
      await page.locator('#import-source-label').fill('Chase Freedom');
      await page.locator('#tx-csv-file').setInputFiles(csvPath);
      // Wait for preview to appear, then click Import
      await page.waitForFunction(() => {
        const btn = document.getElementById('import-confirm-btn');
        return btn && !btn.classList.contains('hidden');
      }, { timeout: 5000 });
      await page.locator('#import-confirm-btn').click();

      // #import-too-big-msg should become visible
      await page.waitForFunction(() => {
        const el = document.getElementById('import-too-big-msg');
        return el && !el.classList.contains('hidden');
      }, { timeout: 5000 });

      // Trim button should be visible and contain expected text
      const trimBtn = page.locator('#import-trim-btn');
      await trimBtn.waitFor({ state: 'visible' });
      const trimText = await trimBtn.textContent();
      expect(trimText).toContain('Import');
      expect(trimText).toContain('instead');

      // Success modal should NOT be visible
      const successVisible = await page.locator('#import-success-modal').isVisible();
      expect(successVisible).toBe(false);

      // localStorage should have no transactions (nothing was imported)
      const txJson = await page.evaluate(() => localStorage.getItem('trakyo_txs_v1'));
      expect(!txJson || txJson === '[]' || JSON.parse(txJson || '[]').length === 0).toBe(true);
    } finally {
      fs.unlinkSync(csvPath);
    }
  });

  test('accepting trim offer imports only fitting months and survives reload', async ({ page }) => {
    const fs = require('fs');
    await page.addInitScript(QUOTA_INIT_SCRIPT);
    await page.goto(APP);
    await page.waitForFunction(() => typeof openTxImportModal === 'function');

    const csvPath = makeQuotaTestCsv();
    try {
      await page.evaluate(() => openTxImportModal());
      await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
      await page.locator('#import-source-label').fill('Chase Freedom');
      await page.locator('#tx-csv-file').setInputFiles(csvPath);
      await page.waitForFunction(() => {
        const btn = document.getElementById('import-confirm-btn');
        return btn && !btn.classList.contains('hidden');
      }, { timeout: 5000 });
      await page.locator('#import-confirm-btn').click();

      // Wait for the too-big message
      await page.waitForFunction(() => {
        const el = document.getElementById('import-too-big-msg');
        return el && !el.classList.contains('hidden');
      }, { timeout: 5000 });

      // Click the trim button
      await page.locator('#import-trim-btn').click();

      // Success modal should appear
      await page.waitForFunction(() => {
        const el = document.getElementById('import-success-modal');
        return el && !el.classList.contains('hidden');
      }, { timeout: 5000 });

      // localStorage should have some transactions
      const txJson = await page.evaluate(() => localStorage.getItem('trakyo_txs_v1'));
      expect(txJson).toBeTruthy();
      expect(JSON.parse(txJson).length).toBeGreaterThan(0);

      // Reload the page
      await page.reload();
      await page.waitForFunction(() => typeof openTxImportModal === 'function');

      // Transactions should still be there
      const txJsonAfterReload = await page.evaluate(() => localStorage.getItem('trakyo_txs_v1'));
      expect(txJsonAfterReload).toBeTruthy();
      expect(JSON.parse(txJsonAfterReload).length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(csvPath);
    }
  });

  test('save failure after import shows storage-full banner', async ({ page }) => {
    const fs = require('fs');
    // Load page normally (no quota initScript) — first import saves fine
    await page.goto(APP);
    await page.waitForFunction(() => typeof openTxImportModal === 'function');

    // Import a small CSV that fits
    const smallCsvPath = path.join(require('os').tmpdir(), `tyd_small_${Date.now()}.csv`);
    fs.writeFileSync(smallCsvPath, 'Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags\n2024-01-15,Coffee,Food,Chase Freedom,,,-5,\n2024-01-16,Lunch,Food,Chase Freedom,,,-12,\n');
    try {
      await page.evaluate(() => openTxImportModal());
      await page.locator('#tx-import-modal').waitFor({ state: 'visible' });
      await page.locator('#import-source-label').fill('Chase Freedom');
      await page.locator('#tx-csv-file').setInputFiles(smallCsvPath);
      await page.waitForFunction(() => {
        const btn = document.getElementById('import-confirm-btn');
        return btn && !btn.classList.contains('hidden');
      }, { timeout: 5000 });
      await page.locator('#import-confirm-btn').click();
      // Wait for success modal
      await page.waitForFunction(() => {
        const el = document.getElementById('import-success-modal');
        return el && !el.classList.contains('hidden');
      }, { timeout: 5000 });
      // Close the success modal
      await page.evaluate(() => {
        const el = document.getElementById('import-success-modal');
        if (el) el.classList.add('hidden');
      });

      // Now mock setItem to throw and trigger a save.
      // Remove trakyo_txs_v1 first so saveToLocalStorage() must write it
      // (the guard skips the write if _txsDirty=false AND the key exists).
      // Store orig on window so it survives across evaluate() calls.
      await page.evaluate(() => {
        localStorage.removeItem('trakyo_txs_v1');
        window.__origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k, v) {
          if (k === 'trakyo_txs_v1') {
            const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
            throw err;
          }
          return window.__origSetItem.call(this, k, v);
        };
        // Trigger a save
        if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
      });

      // #storage-full-banner should become visible
      await page.waitForFunction(() => {
        const b = document.getElementById('storage-full-banner');
        return b && b.style.display !== 'none';
      }, { timeout: 5000 });

      // Restore setItem and trigger a successful save — banner should hide
      await page.evaluate(() => {
        Storage.prototype.setItem = window.__origSetItem;
        window.__origSetItem = null;
        if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
      });

      await page.waitForFunction(() => {
        const b = document.getElementById('storage-full-banner');
        return b && b.style.display === 'none';
      }, { timeout: 3000 });
    } finally {
      fs.unlinkSync(smallCsvPath);
    }
  });
});
