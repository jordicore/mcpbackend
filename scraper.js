import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD } = process.env;
const ANALYTICS_URL = process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (multi-target Power BI capture mode)...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
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

  // === OPEN ANALYTICS ===
  console.log("📊 Navigating to analytics...");
  const analyticsPage = await browser.newPage();
  await analyticsPage.goto(ANALYTICS_URL, { waitUntil: "domcontentloaded" });

  const captured = [];

  // Helper to attach a CDP listener to a given target
  async function attachToTarget(target) {
    try {
      const session = await target.createCDPSession();
      await session.send("Network.enable");
      session.on("Network.requestWillBeSent", (params) => {
        const url = params.request.url;
        if (url.includes("QueryExecutionService") && url.includes("/public/query")) {
          const auth = params.request.headers?.authorization || null;
          const body = params.request.postData || null;
          console.log("📡 Captured Power BI query:", url);
          captured.push({
            url,
            authorization: auth,
            body,
            frameId: params.frameId,
            targetType: target.type(),
            timestamp: new Date().toISOString(),
          });
        }
      });
    } catch (err) {
      // Some internal targets (like workers) don't allow Network domain
    }
  }

  // Attach to all existing targets
  for (const t of browser.targets()) await attachToTarget(t);
  // Also attach to any new ones that appear (e.g. Power BI iframes)
  browser.on("targetcreated", attachToTarget);

  console.log("🕵️ Monitoring all browser targets for 3 minutes...");
  for (let i = 0; i < 12; i++) {
    console.log(`⏳ Still watching... (${(i + 1) * 15}s)`);
    await new Promise((r) => setTimeout(r, 15000));
  }

  if (captured.length > 0) {
    fs.writeFileSync("powerbi-queries.json", JSON.stringify(captured, null, 2));
    console.log(`💾 Saved ${captured.length} Power BI query requests to powerbi-queries.json`);
  } else {
    console.log("⚠️ No Power BI /public/query requests detected.");
  }

  await browser.close();
  console.log("✅ Done.");
}

deepCapture().catch((err) => console.error("❌ Error:", err));
