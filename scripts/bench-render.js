// Times renderBucketGrid() with a large synthetic dataset.
// Not a deploy gate — run manually to profile grid performance:
//   node scripts/bench-render.js
"use strict";
const { chromium } = require("@playwright/test");
const { spawn }    = require("child_process");
const http         = require("http");
const path         = require("path");

const PORT     = 3003;
const BASE_URL = `http://localhost:${PORT}`;

function waitForServer(retries = 20, delayMs = 150) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function attempt() {
      http.get(BASE_URL, () => resolve()).on("error", () => {
        if (++attempts >= retries) return reject(new Error(`Server at ${BASE_URL} did not start`));
        setTimeout(attempt, delayMs);
      });
    }
    attempt();
  });
}

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
  server.unref();
  await waitForServer();

  // Use system Chrome locally (same as playwright.config.js); bundled Chromium in CI
  const launchOptions = process.env.CI ? {} : { channel: "chrome" };
  const browser = await chromium.launch(launchOptions);
  const page = await (await browser.newContext({ bypassCSP: true })).newPage();
  await page.goto(`${BASE_URL}/trakyodollas.html`, { waitUntil: "load" });
  await page.waitForTimeout(400); // let initial render finish
  await page.waitForFunction(() => typeof renderBucketGrid === "function", { timeout: 5000 });

  const { catAvgMs, vendorAvgMs, txCount, monthCount } = await page.evaluate(() => {
    // Build 10 000 transactions across 24 months, 10 categories, 50 vendors
    const MONTHS = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      MONTHS.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const CATS = ["Groceries","Dining","Gas","Shopping","Healthcare","Travel","Entertainment","Utilities","Other","Income"];
    const VENDORS = Array.from({length: 50}, (_, i) => `Vendor ${i}`);
    const txs = [];
    for (let i = 0; i < 10000; i++) {
      const m = MONTHS[i % MONTHS.length];
      const d = String((i % 28) + 1).padStart(2, "0");
      txs.push({
        date: `${m}-${d}`,
        amount: (i % 490) + 10,
        cat: CATS[i % CATS.length],
        desc: VENDORS[i % VENDORS.length],
        card: "Checking",
        excluded: false,
        isIncome: i % CATS.length === 9, // "Income" category
        biz: false,
      });
    }
    // Seed state
    state.transactions = txs;
    state.activeSources = new Set(["Checking"]);
    state.excludedCats = new Set();
    state.activeCats = new Set();
    state.activeVendors = new Set();
    state.showExcluded = false;
    state.bucketShowAll = true;
    // Rebuild MONTHLY and ALL_MONTHS from the synthetic transactions
    const monthly = {};
    txs.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!monthly[m]) monthly[m] = {};
      monthly[m][t.card] = (monthly[m][t.card] || 0) + t.amount;
    });
    Object.keys(monthly).forEach(m => { MONTHLY[m] = monthly[m]; });
    ALL_MONTHS = MONTHS;

    // Warm-up
    state.bucketMode = "category";
    renderBucketGrid();

    const RUNS = 30;
    // Category mode
    const t0 = performance.now();
    for (let i = 0; i < RUNS; i++) renderBucketGrid();
    const catMs = performance.now() - t0;

    // Vendor mode
    state.bucketMode = "vendor";
    renderBucketGrid(); // warm-up
    const t1 = performance.now();
    for (let i = 0; i < RUNS; i++) renderBucketGrid();
    const vendorMs = performance.now() - t1;

    return {
      catAvgMs: Math.round(catMs / RUNS),
      vendorAvgMs: Math.round(vendorMs / RUNS),
      txCount: txs.length,
      monthCount: MONTHS.length,
    };
  });

  console.log(`renderBucketGrid benchmark — ${txCount} txns × ${monthCount} months`);
  console.log(`  category mode: ${catAvgMs}ms avg (${30} runs)`);
  console.log(`  vendor mode:   ${vendorAvgMs}ms avg (${30} runs)`);
  await browser.close();
  server.kill();
})().catch(e => { console.error(e); process.exit(1); });
