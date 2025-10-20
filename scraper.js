import puppeteer from "puppeteer";
import "dotenv/config";
import fs from "fs";

/*
 * Autocab Power BI scraper
 *
 * This script automates logging into the Autocab analytics portal and
 * captures underlying Power BI query traffic. After logging in with
 * credentials from the .env file it navigates to the analytics
 * dashboard, waits for the embedded Power BI iframes to load and
 * collects any requests and responses to Power BI back‑end endpoints.
 *
 * Requests are filtered on two substrings:
 *   - "pbidedicated.windows.net" covers the Power BI dedicated
 *     capacity API used by embedded reports.
 *   - "/QueryExecutionService/automatic/public/query" covers the
 *     legacy report query service sometimes used by older reports.
 *
 * Both the request body and response body are captured if available
 * and persisted to a JSON file (captured-powerbi.json) in the project
 * root. Each entry in the file includes a timestamp, the URL and
 * parsed request/response bodies if they contain JSON. If a body
 * cannot be parsed as JSON it will be stored as the raw string.
 */

const AUTOCAB_USER = process.env.AUTOCAB_USER || process.env.USERNAME;
const AUTOCAB_PASS = process.env.AUTOCAB_PASS || process.env.PASSWORD;
const COMPANY_ID   = process.env.COMPANY_ID;
const ANALYTICS_URL = process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

if (!AUTOCAB_USER || !AUTOCAB_PASS || !COMPANY_ID) {
  console.error("❌ Missing required environment variables in .env");
  process.exit(1);
}

// Main async IIFE so we can use await at the top level
(async () => {
  console.log("🚀 Launching Puppeteer...");
  const browser = await puppeteer.launch({
    // Use the new Headless mode if available for reliability on modern
    // versions of Chromium. Fallback to true for older versions.
    headless: typeof puppeteer.defaultArgs === "function" ? "new" : true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  // Bump default navigation timeout – the Autocab portal can be slow
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(60000);

  try {
    // Navigate to the Autocab login page
    console.log("🔐 Navigating to Autocab365 login page...");
    await page.goto("https://portal.autocab365.com/#/login", {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    // Wait for the login form fields to appear. Some deployments load
    // inputs inside nested components, so we use a generous timeout.
    await page.waitForSelector("input[name='companyId']", { timeout: 60000 });
    await page.type("input[name='companyId']", COMPANY_ID, { delay: 20 });

    await page.waitForSelector("input[name='username']", { timeout: 60000 });
    await page.type("input[name='username']", AUTOCAB_USER, { delay: 20 });

    await page.waitForSelector("input[name='password']", { timeout: 60000 });
    await page.type("input[name='password']", AUTOCAB_PASS, { delay: 20 });

    // Attempt to click any button that appears to be a login/continue action.
    // We inspect all buttons for keywords rather than relying on a specific
    // selector because the markup can vary.
    const buttons = await page.$$("button");
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
      throw new Error("No continue/login button found during login");
    }

    // Wait for navigation after submitting credentials. The portal may
    // redirect through several steps before landing on the dashboard.
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 });
    console.log("✅ Logged in successfully!");

    // Navigate to the analytics dashboard URL defined in .env
    console.log("📊 Navigating to analytics portal...");
    await page.goto(ANALYTICS_URL, { waitUntil: 'networkidle2', timeout: 120000 });

    // Wait for at least one Power BI iframe to load. Not all dashboards
    // embed Power BI at the same time, but many will load iframes with
    // sources pointing at either app.powerbi.com or pbidedicated windows
    // endpoints. We use a broad selector to account for variations.
    try {
      await page.waitForSelector("iframe[src*='powerbi'], iframe[src*='pbidedicated']", { timeout: 90000 });
      console.log("📈 Power BI iframe detected.");
    } catch {
      // If no iframe appears within the timeout the page may still make
      // network calls; continue regardless.
      console.log("⚠️ No Power BI iframe detected – continuing to monitor network anyway.");
    }

    // Array to store captured events
    const capturedEvents = [];

    // Register a response handler to capture request/response bodies. We use
    // the response event to ensure the response body is available. The
    // handler filters URLs and extracts bodies if possible.
    page.on('response', async (res) => {
      try {
        const url = res.url();
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
            // Some responses cannot be consumed (e.g., binary). Leave as null.
          }
          capturedEvents.push({
            timestamp: new Date().toISOString(),
            url,
            requestBody,
            responseBody,
          });
        }
      } catch (err) {
        // Swallow any errors to avoid unhandled promise rejections
        console.warn('⚠️ Error while capturing network event:', err?.message || err);
      }
    });

    // Give the dashboard time to load and generate network traffic. The
    // waiting period can be adjusted via WAIT_MS environment variable or
    // defaults to 120 seconds.
    const waitMs = process.env.WAIT_MS ? parseInt(process.env.WAIT_MS, 10) : 120000;
    console.log(`⏳ Waiting ${Math.round(waitMs / 1000)}s for Power BI queries...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // Persist captured events to JSON file
    const outputPath = 'captured-powerbi.json';
    await fs.promises.writeFile(outputPath, JSON.stringify(capturedEvents, null, 2));
    console.log(`💾 Captured ${capturedEvents.length} Power BI network events`);
    console.log(`📂 Results saved to ${outputPath}`);

    await browser.close();
  } catch (error) {
    console.error('❌ Error:', error?.message || error);
    try {
      await browser.close();
    } catch { /* ignore */ }
    process.exit(1);
  }
})();