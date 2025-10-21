// scraper.js
import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD } = process.env;
const ANALYTICS_URL =
  process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

// 🧩 Helper: Take labeled screenshots
async function debugShot(page, step) {
  const filename = `screenshot-${Date.now()}-${step}.png`;
  await page.screenshot({ path: filename, fullPage: true });
  console.log(`📸 Saved screenshot: ${filename}`);
}

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (Screenshot Debug Mode)...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // === LOGIN ===
  console.log("🌐 Navigating to Autocab portal...");
  await page.goto("https://portal.autocab365.com/#/login", {
    waitUntil: "domcontentloaded",
  });
  await debugShot(page, "login-page-loaded");

  console.log("🏢 Entering company ID...");
  await page.waitForSelector("input[name='companyId']", { timeout: 20000 });
  await page.type("input[name='companyId']", COMPANY_ID, { delay: 50 });
  await debugShot(page, "company-id-entered");

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /continue/i.test(b.innerText)
    );
    if (btn) btn.click();
  });

  console.log("⏳ Waiting for username/password fields...");
  await page.waitForSelector("input[name='username']", { timeout: 20000 });
  await page.waitForSelector("input[name='password']", { timeout: 20000 });
  await debugShot(page, "login-form-visible");

  console.log("👤 Entering username...");
  await page.type("input[name='username']", USERNAME, { delay: 50 });
  console.log("🔐 Entering password...");
  await page.type("input[name='password']", PASSWORD, { delay: 50 });
  await debugShot(page, "credentials-entered");

  console.log("🖱️ Clicking Log In...");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /log\s?in/i.test(b.innerText)
    );
    if (btn) btn.click();
  });

  console.log("⏳ Waiting for dashboard (# in URL)...");
  await page.waitForFunction(() => window.location.href.includes("#/"), {
    timeout: 60000,
  });
  console.log("✅ Logged in and on dashboard!");
  await debugShot(page, "dashboard-loaded");

  // === NAVIGATE TO ANALYTICS ===
  console.log("📊 Navigating to analytics...");
  const analyticsPage = await browser.newPage();
  await analyticsPage.goto(ANALYTICS_URL, { waitUntil: "networkidle2" });
  console.log("✅ Analytics page loaded.");
  await debugShot(analyticsPage, "analytics-loaded");

  console.log("✅ Done. All screenshots saved.");
  await browser.close();
}

deepCapture().catch((err) => console.error("❌ Error:", err));
