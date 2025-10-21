import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD } = process.env;
const ANALYTICS_URL = process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (lazy Power BI capture mode)...");
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

  // === NAVIGATE TO ANALYTICS ===
  console.log("📊 Navigating to analytics...");
  const analyticsPage = await browser.newPage();
  await analyticsPage.goto(ANALYTICS_URL, { waitUntil: "domcontentloaded" });

  // === Try clicking all tab headers until the Power BI iframe appears ===
  console.log("🧭 Clicking tab headers until iframe loads...");
  for (let i = 0; i < 12; i++) {
    const tabs = await analyticsPage.$$("[class*='tab'], [class*='Tab'], .tabset-tab");
    for (const tab of tabs) {
      try {
        await tab.click({ delay: 100 });
        await analyticsPage.waitForTimeout(2000);
      } catch {}
    }

    const iframeUrls = await analyticsPage.evaluate(() =>
      Array.from(document.querySelectorAll("iframe"))
        .map(f => f.src)
        .filter(u => u && u.includes("app.powerbi.com/reportEmbed"))
    );
    if (iframeUrls.length > 0) {
      console.log("✅ Power BI iframe detected:", iframeUrls);
      break;
    }

    console.log(`⏳ No iframe yet... (${(i + 1) * 5}s)`);
    await analyticsPage.waitForTimeout(5000);
  }

  // === Attach network listener to the Power BI frame target ===
  const captured = [];
  const powerbiTarget = await browser.waitForTarget(t =>
    t.url().includes("app.powerbi.com/reportEmbed")
  );

  if (!powerbiTarget) {
    console.log("⚠️ Could not find Power BI frame target.");
  } else {
    console.log("🔗 Attached to Power BI frame target.");
    const session = await powerbiTarget.createCDPSession();
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
          timestamp: new Date().toISOString(),
        });
      }
    });

    console.log("🕵️ Monitoring Power BI traffic for 2 minutes...");
    await new Promise((r) => setTimeout(r, 120000));
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
