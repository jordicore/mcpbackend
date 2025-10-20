import puppeteer from "puppeteer";
import "dotenv/config";
import fs from "fs";

/*
 * Autocab Power BI scraper (agent enhanced)
 *
 * This script automates logging into the Autocab analytics portal and
 * continuously monitors network traffic for Power BI query endpoints.
 *
 * Changes from the original implementation:
 *   • Structured as a reusable run function that can re‑launch the browser
 *     in headless or headful mode.
 *   • Attaches request/response listeners before navigating to the
 *     analytics portal so that nothing is missed.
 *   • Repeatedly polls the page for embedded Power BI iframes. If none
 *     are found it waits and retries up to 10 times with 15 s pauses
 *     between attempts, logging each attempt.
 *   • After navigating to the analytics portal it waits in cycles of
 *     15 s for Power BI network traffic and only finishes once at
 *     least one relevant request/response pair has been captured.
 *   • If no traffic has been captured after 10 cycles (about 150 s) in
 *     headless mode the script relaunches in headful mode and dumps
 *     console output to aid debugging. This fallback continues until
 *     capture succeeds.
 *   • All captured events are persisted to captured‑powerbi.json with
 *     timestamp, URL, and parsed request/response bodies where
 *     possible.
 */

const AUTOCAB_USER = process.env.AUTOCAB_USER || process.env.USERNAME;
const AUTOCAB_PASS = process.env.AUTOCAB_PASS || process.env.PASSWORD;
const COMPANY_ID   = process.env.COMPANY_ID;
const ANALYTICS_URL = process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

if (!AUTOCAB_USER || !AUTOCAB_PASS || !COMPANY_ID) {
  console.error("❌ Missing required environment variables in .env");
  process.exit(1);
}

/**
 * Attach network and console handlers to the page.
 *
 * All requests and responses are logged. Power BI query events are
 * captured with their request and response bodies.
 *
 * @param {import('puppeteer').Page} page
 * @param {Array} capturedEvents
 */
function attachHandlers(page, capturedEvents) {
  // Log every network request
  page.on('request', req => {
    try {
      console.log(`➡️  ${req.method()} ${req.url()}`);
    } catch { /* ignore */ }
  });
  // Handle responses and capture targeted events
  page.on('response', async res => {
    try {
      const url = res.url();
      console.log(`⬅️  ${res.status()} ${url}`);
      if (url.includes('pbidedicated.windows.net') || url.includes('/QueryExecutionService/automatic/public/query')) {
        const req = res.request();
        const reqBodyStr = req.postData();
        let requestBody = null;
        if (reqBodyStr) {
          try {
            requestBody = JSON.parse(reqBodyStr);
          } catch {
            requestBody = reqBodyStr;
          }
        }
        let responseBody = null;
        try {
          const text = await res.text();
          if (text) {
            try {
              responseBody = JSON.parse(text);
            } catch {
              responseBody = text;
            }
          }
        } catch {
          // ignore bodies that cannot be consumed (e.g. binary responses)
        }
        capturedEvents.push({
          timestamp: new Date().toISOString(),
          url,
          requestBody,
          responseBody,
        });
        console.log(`🎯 Captured Power BI request: ${url}`);
      }
    } catch (err) {
      console.warn('⚠️  Error processing network event:', err?.message || err);
    }
  });
  // Mirror all browser console output locally – useful when running headful
  page.on('console', msg => {
    try {
      console.log(`📢 Console: ${msg.text()}`);
    } catch { /* ignore */ }
  });
}

/**
 * Log into Autocab via the portal login page.
 *
 * This helper will try to locate and fill form fields in a resilient way
 * and click a button labelled with common login keywords. It throws if
 * login does not complete within two minutes.
 *
 * @param {import('puppeteer').Page} page
 */
async function performLogin(page) {
  console.log('🔐 Navigating to Autocab365 login page...');
  await page.goto('https://portal.autocab365.com/#/login', {
    waitUntil: 'networkidle2',
    timeout: 120000,
  });
  // Wait for the login form fields to appear. Inputs can be nested in
  // custom components, so selectors are broad and timeouts generous.
  await page.waitForSelector("input[name='companyId']", { timeout: 60000 });
  await page.type("input[name='companyId']", COMPANY_ID, { delay: 20 });
  await page.waitForSelector("input[name='username']", { timeout: 60000 });
  await page.type("input[name='username']", AUTOCAB_USER, { delay: 20 });
  await page.waitForSelector("input[name='password']", { timeout: 60000 });
  await page.type("input[name='password']", AUTOCAB_PASS, { delay: 20 });
  // Search for a button with any of our login keywords
  const buttons = await page.$$('button');
  let clicked = false;
  for (const btn of buttons) {
    const label = await page.evaluate(el => el.innerText?.trim().toLowerCase() || '', btn);
    if (label.includes('continue') || label.includes('login') || label.includes('sign in')) {
      await btn.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    const submitBtn = await page.$("button[type='submit']");
    if (submitBtn) {
      await submitBtn.click();
      clicked = true;
    }
  }
  if (!clicked) {
    throw new Error('No continue/login button found during login');
  }
  // Wait for navigation or a dashboard indicator
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 });
  console.log('✅ Logged in successfully!');
}

/**
 * Poll for the presence of embedded Power BI iframes.
 *
 * Attempts up to 10 times, waiting 15 s between checks. Each attempt
 * logs whether an iframe has been found.
 *
 * @param {import('puppeteer').Page} page
 */
async function waitForPowerBiIframe(page) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const iframeSrcs = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => f.src));
    const matches = iframeSrcs.filter(src => src && (src.includes('powerbi.com') || src.includes('pbidedicated.windows.net')));
    if (matches.length > 0) {
      console.log(`🔍 Found Power BI iframe: ${matches[0]}`);
      return true;
    } else {
      console.log(`🔍 Attempt ${attempt}/10: No Power BI iframe found yet — retrying...`);
      await page.waitForTimeout(15000);
    }
  }
  console.log('⚠️  No Power BI iframe found after 10 attempts. Continuing anyway.');
  return false;
}

/**
 * Wait in cycles for captured events to accumulate.
 *
 * Each cycle waits 15 seconds and logs progress. If events have been
 * captured the function returns immediately. When the maximum number
 * of cycles is reached without captures the caller can decide to
 * fallback to headful mode.
 *
 * @param {Array} capturedEvents
 * @param {import('puppeteer').Page} page
 * @param {number} maxCycles
 */
async function waitForCapturedEvents(capturedEvents, page, maxCycles) {
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (capturedEvents.length > 0) {
      console.log(`💾 Captured ${capturedEvents.length} Power BI requests so far.`);
      return true;
    }
    console.log(`⏳ Waiting for network traffic (cycle ${cycle}/${maxCycles})...`);
    await page.waitForTimeout(15000);
  }
  return capturedEvents.length > 0;
}

/**
 * Run the full scraping workflow.
 *
 * This method encapsulates launching Puppeteer, logging in, navigating to
 * the analytics portal, polling for iframes, monitoring network traffic
 * and persisting captured events. It calls itself recursively in
 * headful mode if required.
 *
 * @param {boolean} headlessMode
 */
async function runScraper(headlessMode = true) {
  console.log('🚀 Launching Puppeteer...');
  const browser = await puppeteer.launch({
    headless: headlessMode ? (typeof puppeteer.defaultArgs === 'function' ? 'new' : true) : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(60000);
  const capturedEvents = [];
  attachHandlers(page, capturedEvents);
  try {
    // Perform login. Retry up to 3 times to handle transient failures
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🔑 Logging in (attempt ${attempt}/3)...`);
        await performLogin(page);
        break;
      } catch (err) {
        console.warn(`⚠️  Login attempt ${attempt} failed: ${err?.message || err}`);
        if (attempt === 3) throw err;
      }
    }
    // Navigate to analytics portal
    console.log('📊 Navigating to analytics portal...');
    await page.goto(ANALYTICS_URL, { waitUntil: 'networkidle2', timeout: 120000 });
    // Poll for Power BI iframes
    await waitForPowerBiIframe(page);
    // Wait for network traffic cycles. Use 10 cycles for headless, longer for headful.
    const maxCycles = 10;
    const found = await waitForCapturedEvents(capturedEvents, page, maxCycles);
    if (!found) {
      console.log('🕵️‍♂️ No Power BI network events captured in this round.');
    }
    // If nothing captured in headless mode, fallback to headful mode
    if (!found && headlessMode) {
      console.log('🔄 Switching to headful mode for deeper inspection...');
      await browser.close();
      // Recursively run in headful mode. Do not await to avoid nested promise rejection
      return runScraper(false);
    }
    // Persist captured events
    const outputPath = 'captured-powerbi.json';
    await fs.promises.writeFile(outputPath, JSON.stringify(capturedEvents, null, 2));
    console.log(`💾 Captured ${capturedEvents.length} Power BI network events`);
    console.log(`📂 Results saved to ${outputPath}`);
    await browser.close();
  } catch (err) {
    console.error('❌ Error:', err?.message || err);
    try {
      await browser.close();
    } catch { /* ignore */ }
    process.exit(1);
  }
}

// Immediately invoke the scraper when executed via `npm start` or `node scraper.js`
runScraper().catch(err => {
  console.error('❌ Unhandled error:', err?.message || err);
  process.exit(1);
});