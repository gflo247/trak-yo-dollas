#!/usr/bin/env node
// scripts/check-axe.js
// Runs axe-core against trakyodollas.html in both dark and light themes.
// Exits non-zero if any WCAG 2.1 AA violations are found.
// Usage: node scripts/check-axe.js [path/to/file.html]
//
// No arg (default): full suite — app at desktop + 360px + 430px, plus all
// static pages (landing, privacy, guides) at desktop in both themes.
// With arg: single-file mode — audits that file at desktop in both themes
// (used by deploy.sh to re-check the minified trakyodollas.html after Terser).
//
// Uses system Chrome locally (channel:'chrome', matches playwright.config.js)
// and Playwright's bundled Chromium in CI (no channel, set CI=true).

'use strict';

const { chromium } = require('@playwright/test');
const { spawn }    = require('child_process');
const http         = require('http');
const path         = require('path');
const fs           = require('fs');

const EXPLICIT_FILE = process.argv[2] || null;
const APP_FILE      = EXPLICIT_FILE || 'trakyodollas.html';
const PORT          = 3002;
const BASE_URL      = `http://localhost:${PORT}`;
const AXE_PATH      = path.resolve('node_modules/axe-core/axe.min.js');

// In single-file mode (explicit arg), only check desktop — the caller already
// ran the full-suite check on the source file; this re-check is just for
// minification-introduced breakage.
const APP_VIEWPORTS = EXPLICIT_FILE
  ? [{ width: 1280, height: 800, label: 'desktop' }]
  : [
      { width: 1280, height: 800, label: 'desktop' },
      { width: 430,  height: 932, label: '430px'   },
      { width: 360,  height: 780, label: '360px'   },
    ];

// Static pages are only checked in full-suite mode.
const STATIC_PAGES = EXPLICIT_FILE ? [] : [
  'index.html',
  'privacy.html',
  'guides/index.html',
  'guides/ally.html',
  'guides/bofa.html',
  'guides/capitalone.html',
  'guides/chase.html',
  'guides/citi.html',
  'guides/discover.html',
  'guides/investment-accounts.html',
  'guides/usbank.html',
  'guides/wellsfargo.html',
];

const APP_TABS = [
  { label: 'Spending',     action: null },
  { label: 'Budget',       action: 'showPageBudget' },
  { label: 'Net Worth',    action: 'showPageDashboard' },
  { label: 'Life Changes', action: 'showPageSimulator' },
];

function waitForServer(retries = 20, delayMs = 150) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function attempt() {
      http.get(BASE_URL, () => resolve()).on('error', () => {
        if (++attempts >= retries) return reject(new Error(`Server at ${BASE_URL} did not start`));
        setTimeout(attempt, delayMs);
      });
    }
    attempt();
  });
}

function reportViolations(label, results) {
  if (results.violations.length === 0) {
    console.log(`  ✓ ${label}: no violations`);
    return false;
  }
  console.error(`\n  ❌ ${results.violations.length} violation(s) in ${label}:`);
  for (const v of results.violations) {
    console.error(`  [${v.impact}] ${v.id}: ${v.description}`);
    for (const n of v.nodes.slice(0, 2)) {
      const snippet = n.html.length > 120 ? n.html.slice(0, 120) + '…' : n.html;
      console.error(`    → ${snippet}`);
    }
  }
  return true;
}

async function main() {
  if (!fs.existsSync(AXE_PATH)) {
    console.error('axe-core not found — run: npm install');
    process.exit(1);
  }
  const axeSource = fs.readFileSync(AXE_PATH, 'utf8');

  // Serve the repo root so relative asset paths resolve correctly
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
  server.unref();

  try {
    await waitForServer();

    // System Chrome locally (matches playwright.config.js); bundled Chromium in CI
    const launchOptions = process.env.CI ? {} : { channel: 'chrome' };
    const browser = await chromium.launch(launchOptions);
    let failed = false;

    try {
      // --- App: all viewports × themes × tabs ---
      for (const vp of APP_VIEWPORTS) {
        for (const theme of ['dark', 'light']) {
          const ctx  = await browser.newContext({
            bypassCSP: true,
            colorScheme: theme,
            viewport: { width: vp.width, height: vp.height },
          });
          const page = await ctx.newPage();
          // Suppress Supabase/analytics connection errors — expected in a test env
          page.on('console', () => {});
          page.on('pageerror', () => {});

          // Pre-set the theme before any page scripts run so that
          // init-time side-effects (e.g. showToast) pick the right
          // theme-aware colors from the start. Setting via evaluate
          // after goto() races with DOMContentLoaded and leaves stale
          // inline styles when the page fires toasts during dark-mode init.
          await ctx.addInitScript(t => {
            document.documentElement.setAttribute('data-theme', t);
          }, theme);

          await page.goto(`${BASE_URL}/${APP_FILE}`, { waitUntil: 'load' });
          await page.addScriptTag({ content: axeSource });
          // Brief pause for JS to finish rendering the initial demo state
          await page.waitForTimeout(400);

          // Run axe on every tab so contrast/ARIA violations in Budget, Net
          // Worth, and Life Changes are caught — previously only Spending was
          // checked (the initial active tab), so hardcoded hex colors that
          // failed on the light theme in other tabs went undetected until
          // this was widened.
          for (const tab of APP_TABS) {
            if (tab.action) {
              await page.click(`[data-action="${tab.action}"]`);
              await page.waitForTimeout(300);
            }

            const results = await page.evaluate(() => axe.run(document, {
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
            }));

            const label = `${theme} / ${vp.label} / ${tab.label}`;
            if (reportViolations(label, results)) failed = true;
          }

          await ctx.close();
        }
      }

      // --- Static pages: desktop × themes ---
      for (const staticPage of STATIC_PAGES) {
        for (const theme of ['dark', 'light']) {
          const ctx  = await browser.newContext({
            bypassCSP: true,
            colorScheme: theme,
            viewport: { width: 1280, height: 800 },
          });
          const page = await ctx.newPage();
          page.on('console', () => {});
          page.on('pageerror', () => {});

          await ctx.addInitScript(t => {
            document.documentElement.setAttribute('data-theme', t);
          }, theme);

          await page.goto(`${BASE_URL}/${staticPage}`, { waitUntil: 'load' });
          // Freeze staggered fade-in animations so axe never sees an element
          // mid-animation (opacity:0, contrast:0). Setting duration to a tiny
          // value lets the browser fire the animation and reach its fill-mode
          // final state (opacity:1) in the same paint, removing the timing race
          // that caused intermittent contrast false-positives on .fu/.fu3 nodes.
          await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0.0001s !important; animation-delay: 0s !important; }' });
          await page.addScriptTag({ content: axeSource });
          await page.waitForTimeout(200);

          const results = await page.evaluate(() => axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          }));

          const label = `${theme} / desktop / ${staticPage}`;
          if (reportViolations(label, results)) failed = true;

          await ctx.close();
        }
      }
      // --- Import panel states: desktop + 390px × dark + light ---
      if (!EXPLICIT_FILE) {
        const IMPORT_VPS = [
          { width: 1280, height: 800, label: 'desktop' },
          { width: 390,  height: 844, label: '390px'   },
        ];
        const fixtureCsv = fs.readFileSync(
          path.join(__dirname, '..', 'e2e', 'fixtures', 'sample.csv'), 'utf8');

        // Helper: open a fresh page in a given state, run axe, close.
        async function auditImportState(label, setupFn, initScript) {
          const ctxOpts = {
            bypassCSP: true,
            colorScheme: label.includes('dark') ? 'dark' : 'light',
            viewport: { width: label.includes('390px') ? 390 : 1280,
                        height: label.includes('390px') ? 844 : 800 },
          };
          const ctx = await browser.newContext(ctxOpts);
          const page = await ctx.newPage();
          page.on('console', () => {});
          page.on('pageerror', () => {});
          await ctx.addInitScript(t => document.documentElement.setAttribute('data-theme', t),
            label.includes('dark') ? 'dark' : 'light');
          if (initScript) await ctx.addInitScript(initScript);
          await page.goto(`${BASE_URL}/${APP_FILE}`, { waitUntil: 'load' });
          await page.addScriptTag({ content: axeSource });
          await page.waitForTimeout(400);
          await setupFn(page);
          await page.waitForTimeout(400);
          const results = await page.evaluate(() =>
            axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
          if (reportViolations(label, results)) failed = true;
          await ctx.close();
        }

        const QUOTA_SCRIPT = `(function(){
  const LIMIT=400000,orig=Storage.prototype.setItem;
  Object.defineProperty(Storage.prototype,'setItem',{value:function(k,v){
    let t=k.length+String(v).length;
    for(let i=0;i<this.length;i++){const ek=this.key(i);if(ek!==k)t+=ek.length+(this.getItem(ek)||'').length;}
    if(t>LIMIT){const e=new DOMException('QuotaExceededError','QuotaExceededError');throw e;}
    return orig.call(this,k,v);},configurable:true,writable:true});})();`;

        for (const vp of IMPORT_VPS) {
          for (const theme of ['dark', 'light']) {
            const pfx = `${theme} / ${vp.label} / import`;

            // 1. Import panel open (empty)
            await auditImportState(`${pfx}: panel open`, async page => {
              await page.evaluate(() => openTxImportModal());
            });

            // 2. Import panel with preview
            await auditImportState(`${pfx}: panel with preview`, async (page) => {
              await page.evaluate(async csv => {
                openTxImportModal();
                const file = new File([csv], 'sample.csv', { type: 'text/csv' });
                parseTxFile(file);
                await new Promise(r => setTimeout(r, 350));
              }, fixtureCsv);
            });

            // 3. Can't-read message (zero rows from a valid CSV)
            await auditImportState(`${pfx}: zero-row message`, async page => {
              await page.evaluate(() => {
                openTxImportModal();
                window._importRawHeader = 'Col1,Col2,Col3';
                window._importRawRows  = [];
                showImportPreview([]);
              });
            });

            // 4. Wrong-file message (QFX file)
            await auditImportState(`${pfx}: wrong-file message`, async page => {
              await page.evaluate(async () => {
                openTxImportModal();
                const file = new File(['OFXHEADER:100\nDATA:OFXSGML\n'], 'statement.qfx');
                parseTxFile(file);
                await new Promise(r => setTimeout(r, 350));
              });
            });

            // 5. Too-big message (call _showImportTooBig directly — avoids
            //    needing a large file; audits the UI state axe would see)
            await auditImportState(`${pfx}: too-big message`, async page => {
              await page.evaluate(() => {
                openTxImportModal();
                _showImportTooBig(5000, null);
              });
            });

            // 6. Storage-full banner
            await auditImportState(`${pfx}: storage-full banner`, async page => {
              await page.evaluate(() => _showStorageFullBanner());
            });

            // 7. Category filter applied (uses demo data already loaded)
            await auditImportState(`${pfx}: category filter`, async page => {
              await page.evaluate(() => {
                // Pick the first visible category chip and activate it
                const chip = document.querySelector('[data-action="toggleCatFilter"]');
                if (chip) chip.click();
              });
            });
          }
        }
      }
    } finally {
      await browser.close();
    }

    if (failed) {
      console.error('\nFix axe-core violations before deploying.');
      process.exit(1);
    }
    console.log('\n  PASS: axe-core found no violations');
  } finally {
    server.kill();
  }
}

main().catch(e => {
  console.error('check-axe.js error:', e.message);
  process.exit(1);
});
