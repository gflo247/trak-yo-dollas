#!/usr/bin/env node
// scripts/make-site-images.js
// Takes the three site screenshot files used for the landing page and OG image.
// Run manually when screenshots need to be retaken.
//
// Output files (repo root):
//   app-screenshot.webp        1600×896  dark theme  — straight app screenshot
//   app-screenshot-light.webp  1600×898  light theme — straight app screenshot
//   og.png                     1200×630  dark theme  — branded layout:
//                                          logo + wordmark + tagline (top)
//                                          total-spend card + category tiles (bottom)
//
// Uses system Chrome locally (channel:'chrome', matches playwright.config.js)
// and Playwright's bundled Chromium in CI (no channel, set CI=true).
// Port 3003 — does not conflict with check-axe.js's port 3002.
//
// Do NOT run as part of the automated audit; this is a manual retake tool.

'use strict';

const { chromium } = require('@playwright/test');
const { spawn }    = require('child_process');
const http         = require('http');
const path         = require('path');
const fs           = require('fs');

const PORT     = 3003;
const BASE_URL = `http://localhost:${PORT}`;
const ROOT     = path.resolve(__dirname, '..');

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

// Straight app screenshot — demo profile loaded, banners and badges hidden.
async function takeAppShot(browser, { width, height, theme, outFile }) {
  const outPath = path.join(ROOT, outFile);
  console.log(`  Taking ${outFile} (${width}×${height}, ${theme})…`);

  const ctx = await browser.newContext({
    bypassCSP: true,
    colorScheme: theme,
    viewport: { width, height },
  });
  const page = await ctx.newPage();
  page.on('console', () => {});
  page.on('pageerror', () => {});

  // Pre-set the theme before any page scripts run, same rationale as check-axe.js.
  await ctx.addInitScript(t => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);

  await page.goto(`${BASE_URL}/trakyodollas.html`, { waitUntil: 'load' });

  // Load demo profile 1 for a realistic, populated screenshot.
  await page.evaluate(() => loadDemoProfile(1));
  await page.waitForTimeout(600);

  // Hide first-visit banners, the toast element, and any "start here" badge
  // so they don't appear in the screenshot.
  await page.evaluate(() => {
    const selectors = [
      '#first-visit-banner',
      '#first-visit-overlay',
      '#toast',
      '[data-start-here]',
      '.start-here-badge',
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
    });
  });

  await page.screenshot({ path: outPath, type: outFile.endsWith('.png') ? 'png' : 'webp' });
  console.log(`  Saved ${outFile}`);
  await ctx.close();
}

// Branded OG image: logo + wordmark + tagline over total-spend card + category tiles.
// Matches the layout of the original og.png: no nav, no banners, no demo badge.
async function takeOgShot(browser, { width, height, outFile }) {
  const outPath = path.join(ROOT, outFile);
  console.log(`  Taking ${outFile} (${width}×${height}, dark, branded)…`);

  const ctx = await browser.newContext({
    bypassCSP: true,
    colorScheme: 'dark',
    viewport: { width, height },
  });
  const page = await ctx.newPage();
  page.on('console', () => {});
  page.on('pageerror', () => {});

  await ctx.addInitScript(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  await page.goto(`${BASE_URL}/trakyodollas.html`, { waitUntil: 'load' });
  await page.evaluate(() => loadDemoProfile(1));
  await page.waitForTimeout(600);

  // ── Inject branded layout ────────────────────────────────────────────────
  await page.evaluate(({ w, h }) => {
    // 1. Remove all page chrome: nav, banners, demo nudge, footer.
    [
      'nav.nav',
      '#demo-nudge',
      '#demo-preview-banner',
      '#offline-banner',
      '#local-data-notice-banner',
      '#ios-home-screen-banner',
      '#mac-safari-banner',
      '#storage-full-banner',
      '#sync-conflict-banner',
      '#toast',
      'footer.app-footer',
    ].forEach(sel => document.querySelectorAll(sel).forEach(el => {
      el.style.display = 'none';
    }));

    // 2. Inside the Spending page, hide everything except the stats card and tiles.
    const spendPage = document.getElementById('page-spending');
    if (!spendPage) return;
    Array.from(spendPage.children).forEach(child => {
      // Keep .spend-total-card and #bucket-grid visible; hide everything else.
      const keep = child.classList.contains('spend-total-card') ||
                   child.id === 'bucket-grid';
      if (!keep) child.style.display = 'none';
    });

    // 3. Remove all page padding and constrain to viewport size.
    document.body.style.cssText = `margin:0;padding:0;overflow:hidden;width:${w}px;height:${h}px;background:var(--bg-page)`;
    spendPage.style.cssText = `display:block;padding:0;margin:0;width:${w}px`;

    // 4. Inject branded header above the stats card.
    const header = document.createElement('div');
    header.id = 'og-branded-header';
    header.style.cssText = [
      'display:flex', 'flex-direction:column', 'align-items:center',
      'justify-content:center', 'padding:52px 0 36px',
      'background:var(--bg-page)',
    ].join(';');
    header.innerHTML = [
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">',
        '<svg width="52" height="52" viewBox="28 4 44 90" fill="none" xmlns="http://www.w3.org/2000/svg">',
          '<path stroke="#34D399" stroke-width="6" stroke-linecap="round" fill="none"',
            ' d="M66 41C62 35 56 32 50 32C42 32 35.5 36 35.5 43C35.5 50 42 52 50 54',
            'C58 56 64.5 58 64.5 65C64.5 72 58 75.5 50 75.5C43 75.5 37 72.5 34 67"/>',
          '<path stroke="#F1F5F9" stroke-width="6" stroke-linecap="round" fill="none"',
            ' d="M50 9V76Q50 88 62 88M37 26L66 16"/>',
        '</svg>',
        '<span style="font-family:\'DM Mono\',monospace;font-size:40px;font-weight:500;color:#F1F5F9;letter-spacing:.02em">',
          'trak-yo-dolla<span style="color:#34D399">$</span>',
        '</span>',
      '</div>',
      '<div style="font-size:22px;color:#94A3B8;letter-spacing:.01em">',
        'No bank login. No subscriptions. Nothing sold.',
      '</div>',
    ].join('');

    spendPage.insertBefore(header, spendPage.firstChild);

    // 5. Tighten margins on the stats card so it sits flush under the header.
    const statsCard = spendPage.querySelector('.spend-total-card');
    if (statsCard) statsCard.style.cssText = 'margin-top:0;margin-bottom:12px';

    // 6. Reset body scroll to top.
    window.scrollTo(0, 0);
  }, { w: width, h: height });

  // Small settle pause after DOM rewrite.
  await page.waitForTimeout(200);

  await page.screenshot({
    path: outPath,
    type: 'png',
    clip: { x: 0, y: 0, width, height },
  });
  console.log(`  Saved ${outFile}`);
  await ctx.close();
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)],
    { cwd: ROOT, stdio: 'ignore' });
  server.unref();

  try {
    console.log(`Starting HTTP server on port ${PORT}…`);
    await waitForServer();
    console.log('Server ready.\n');

    // System Chrome locally; bundled Chromium in CI
    const launchOptions = process.env.CI ? {} : { channel: 'chrome' };
    const browser = await chromium.launch(launchOptions);

    try {
      await takeAppShot(browser, { width: 1600, height: 896,  theme: 'dark',  outFile: 'app-screenshot.webp' });
      await takeAppShot(browser, { width: 1600, height: 898,  theme: 'light', outFile: 'app-screenshot-light.webp' });
      await takeOgShot(browser,  { width: 1200, height: 630,               outFile: 'og.png' });
    } finally {
      await browser.close();
    }

    console.log('\nAll screenshots saved.');
  } catch (e) {
    console.error('make-site-images.js error:', e.message);
    process.exit(1);
  } finally {
    server.kill();
  }
}

main();
