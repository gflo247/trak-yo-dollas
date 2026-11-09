#!/usr/bin/env node
// scripts/make-site-images.js
// Takes the three site screenshot files used for the landing page and OG image.
// Run manually when screenshots need to be retaken.
//
// Output files (repo root):
//   app-screenshot.webp   1600×896  dark theme
//   app-screenshot-light.webp  1600×898  light theme
//   og.png                1200×630  dark theme
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

async function takeShot(browser, { width, height, theme, outFile }) {
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
      await takeShot(browser, { width: 1600, height: 896,  theme: 'dark',  outFile: 'app-screenshot.webp' });
      await takeShot(browser, { width: 1600, height: 898,  theme: 'light', outFile: 'app-screenshot-light.webp' });
      await takeShot(browser, { width: 1200, height: 630,  theme: 'dark',  outFile: 'og.png' });
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
