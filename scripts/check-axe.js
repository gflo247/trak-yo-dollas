#!/usr/bin/env node
// scripts/check-axe.js
// Runs axe-core against trakyodollas.html in both dark and light themes.
// Exits non-zero if any WCAG 2.1 AA violations are found.
// Usage: node scripts/check-axe.js [path/to/file.html]
// Defaults to trakyodollas.html in the repo root.
//
// Uses system Chrome locally (channel:'chrome', matches playwright.config.js)
// and Playwright's bundled Chromium in CI (no channel, set CI=true).

'use strict';

const { chromium } = require('@playwright/test');
const { spawn }    = require('child_process');
const http         = require('http');
const path         = require('path');
const fs           = require('fs');

const HTML_FILE = process.argv[2] || 'trakyodollas.html';
const PORT      = 3002;
const BASE_URL  = `http://localhost:${PORT}`;
const AXE_PATH  = path.resolve('node_modules/axe-core/axe.min.js');

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
      for (const theme of ['dark', 'light']) {
        const ctx  = await browser.newContext({ bypassCSP: true, colorScheme: theme });
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

        await page.goto(`${BASE_URL}/${HTML_FILE}`, { waitUntil: 'load' });
        await page.addScriptTag({ content: axeSource });
        // Brief pause for JS to finish rendering the initial demo state
        await page.waitForTimeout(400);

        const results = await page.evaluate(() => axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        }));

        await ctx.close();

        if (results.violations.length === 0) {
          console.log(`  ✓ ${theme} theme: no violations`);
        } else {
          console.error(`\n  ❌ ${results.violations.length} violation(s) in ${theme} theme:`);
          for (const v of results.violations) {
            console.error(`  [${v.impact}] ${v.id}: ${v.description}`);
            for (const n of v.nodes.slice(0, 2)) {
              const snippet = n.html.length > 120 ? n.html.slice(0, 120) + '…' : n.html;
              console.error(`    → ${snippet}`);
            }
          }
          failed = true;
        }
      }
    } finally {
      await browser.close();
    }

    if (failed) {
      console.error('\nFix axe-core violations before deploying.');
      process.exit(1);
    }
    console.log('\n  PASS: axe-core found no violations in dark or light theme');
  } finally {
    server.kill();
  }
}

main().catch(e => {
  console.error('check-axe.js error:', e.message);
  process.exit(1);
});
