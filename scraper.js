import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD } = process.env;
const ANALYTICS_URL = process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (Power BI Fetch Capture Mode)...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1400, height: 900 },
  });

  const page = await browser.newPage();

  // === LOGIN ===
  await page.goto("https://portal.autocab365.com/#/login", {
    waitUntil: "domcontentloaded",
  });

  console.log("🏢 Entering company ID...");
  await page.waitForSelector("input[name='companyId']", { timeout: 20000 });
  await page.type("input[name='companyId']", COMPANY_ID, { delay: 50 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b =>
      /continue/i.test(b.innerText)
    );
    if (btn) btn.click();
  });

  console.log("⏳ Waiting for username/password fields...");
  await page.waitForSelector("input[name='username']", { timeout: 20000 });
  await page.waitForSelector("input[name='password']", { timeout: 20000 });

  console.log("👤 Entering username...");
  await page.type("input[name='username']", USERNAME, { delay: 50 });
  console.log("🔐 Entering password...");
  await page.type("input[name='password']", PASSWORD, { delay: 50 });

  console.log("🖱️ Clicking Log In...");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b =>
      /log\s?in/i.test(b.innerText)
    );
    if (btn) btn.click();
  });

  console.log("⏳ Waiting for dashboard (# in URL)...");
  await page.waitForFunction(() => window.location.href.includes("#/"), {
    timeout: 60000,
  });
  console.log("✅ Logged in and on dashboard!");

  // === ANALYTICS PAGE ===
  const analyticsPage = await browser.newPage();

  // 🧠 Inject fetch interceptor before any script runs
  await analyticsPage.evaluateOnNewDocument(() => {
    const origFetch = window.fetch;
    window.__capturedFetches = [];
    window.fetch = async (...args) => {
      const [url, opts] = args;
      try {
        if (url.includes("QueryExecutionService") && url.includes("/public/query")) {
          const body = opts?.body || null;
          const headers = opts?.headers || {};
          const auth =
            headers.Authorization || headers.authorization || headers["AUTHORIZATION"] || null;
          window.__capturedFetches.push({
            url,
            auth,
            body,
            time: new Date().toISOString(),
          });
          console.log("📡 Captured Power BI fetch:", url);
        }
      } catch (e) {
        console.warn("⚠️ fetch hook error:", e);
      }
      return origFetch(...args);
    };
  });

  console.log("📊 Navigating to analytics...");
  await analyticsPage.goto(ANALYTICS_URL, { waitUntil: "domcontentloaded" });

  console.log("🕵️ Waiting for Power BI network activity (2 minutes)...");
  await new Promise(r => setTimeout(r, 120000));

  const captured = await analyticsPage.evaluate(() => window.__capturedFetches || []);

  if (captured.length > 0) {
    fs.writeFileSync("powerbi-queries.json", JSON.stringify(captured, null, 2));
    console.log(`💾 Saved ${captured.length} Power BI query requests to powerbi-queries.json`);
  } else {
    console.log("⚠️ No Power BI /public/query requests detected.");
  }

  await browser.close();
  console.log("✅ Done.");
}

deepCapture().catch(err => console.error("❌ Error:", err));
