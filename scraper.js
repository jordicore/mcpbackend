// scraper.js
import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const COMPANY_ID = process.env.COMPANY_ID;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;
const ANALYTICS_URL = process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

async function runScraper() {
  console.log("🚀 Launching Puppeteer (Power BI Query Capture Mode)...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(90000);

  try {
    console.log("🌐 Navigating to Autocab365 login page...");
    await page.goto("https://portal.autocab365.com/#/login", { waitUntil: "networkidle2" });

// === Step 1: Enter Company ID ===
console.log("🏢 Entering company ID...");
await page.waitForSelector("input[type='text']", { visible: true });
await page.type("input[type='text']", COMPANY_ID, { delay: 100 });

// Find the first visible, enabled button and click it
const buttons = await page.$$("button");
let clicked = false;

for (const btn of buttons) {
  const text = await page.evaluate(el => el.innerText.trim(), btn);
  const disabled = await page.evaluate(el => el.disabled, btn);

  if (!disabled && /continue/i.test(text)) {
    await btn.evaluate(el => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    console.log(`➡️ Clicking Continue button ("${text}")...`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      btn.click({ delay: 50 }),
    ]);
    clicked = true;
    break;
  }
}

if (!clicked) {
  throw new Error("❌ Could not find visible Continue button after entering company ID");
}



    // === Step 2: Enter Username and Password ===
    console.log("⏳ Waiting for username/password fields...");
    await page.waitForSelector("input[type='email'], input[name='username']", { visible: true });
    await page.waitForSelector("input[type='password']", { visible: true });

    console.log("👤 Entering username...");
    await page.type("input[type='email'], input[name='username']", USERNAME, { delay: 80 });

    console.log("🔐 Entering password...");
    await page.type("input[type='password']", PASSWORD, { delay: 80 });

    console.log("🖱️ Clicking Log In...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      page.click("button[type='submit'], button:has-text('Log In')"),
    ]);

    // === Step 3: Wait for dashboard ===
    console.log("⏳ Waiting for dashboard (# in URL)...");
    await page.waitForFunction(() => window.location.href.includes("#"), { timeout: 60000 });
    console.log("✅ Logged in and on dashboard!");

    // === Step 4: Open analytics.autocab365.com ===
    console.log("📊 Navigating to analytics...");
    const analyticsPage = await browser.newPage();
    await analyticsPage.goto(ANALYTICS_URL, { waitUntil: "networkidle2" });

    // === Step 5: Capture Power BI Queries ===
    console.log("🕵️ Watching for Power BI QueryExecutionService calls...");
    const captured = [];

    analyticsPage.on("request", req => {
      const url = req.url();
      if (url.includes("QueryExecutionService") && url.endsWith("/query")) {
        const headers = req.headers();
        const body = req.postData();
        captured.push({ url, headers, body });
        console.log("📡 Captured Power BI query:", url);
      }
    });

    console.log("⏳ Monitoring network for 120 s...");
    await new Promise(r => setTimeout(r, 120000));

    // === Step 6: Save results ===
    if (captured.length === 0) {
      console.log("⚠️ No Power BI queries captured.");
    } else {
      fs.writeFileSync("powerbi-queries.json", JSON.stringify(captured, null, 2));
      console.log(`💾 Saved ${captured.length} Power BI queries to powerbi-queries.json`);
    }

  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await browser.close();
    console.log("✅ Done.");
  }
}

runScraper();
