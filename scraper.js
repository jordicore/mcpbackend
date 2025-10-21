import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD } = process.env;
const ANALYTICS_URL = "https://analytics.autocab365.com";

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (Power BI Query Capture Mode)...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });

  // === LOGIN ===
  console.log("🌐 Navigating to Autocab365 login page...");
  await page.goto("https://portal.autocab365.com/#/login", {
    waitUntil: "domcontentloaded",
  });

  console.log("🏢 Entering company ID...");
  await page.waitForSelector("input[name='companyId']", { visible: true });
  await page.click("input[name='companyId']", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("input[name='companyId']", COMPANY_ID, { delay: 75 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b =>
      /continue/i.test(b.innerText)
    );
    if (btn) btn.click();
  });

  console.log("⏳ Waiting for username/password fields...");
  await page.waitForSelector("input[name='username']", { visible: true });
  await page.waitForSelector("input[name='password']", { visible: true });
  await page.screenshot({ path: `screenshot-${Date.now()}-login-form.png` });

  console.log("👤 Entering username...");
  await page.click("input[name='username']", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("input[name='username']", USERNAME, { delay: 100 });

  console.log("🔐 Entering password...");
  await page.click("input[name='password']", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("input[name='password']", PASSWORD, { delay: 100 });

  console.log("🖱️ Clicking Log In...");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b =>
      /log\s?in/i.test(b.innerText)
    );
    if (btn) btn.click();
  });

  // === CONFIRM LOGIN SUCCESS ===
  console.log("⏳ Waiting for dashboard to confirm login...");
  const dashboardDetected = await page.waitForFunction(
    () => {
      const text = document.body.innerText.toLowerCase();
      return (
        text.includes("booking & dispatch") ||
        text.includes("management") ||
        text.includes("accounts (legacy)") ||
        text.includes("accounts v2") ||
        text.includes("analytics") ||
        text.includes("connect")
      );
    },
    { timeout: 120000 } // wait up to 2 minutes
  );

  if (dashboardDetected) {
    console.log("✅ Logged in successfully — dashboard detected!");
    await page.screenshot({ path: `screenshot-${Date.now()}-dashboard.png` });
  } else {
    console.error("❌ Login failed — dashboard not detected.");
    await page.screenshot({ path: `screenshot-${Date.now()}-login-failed.png` });
    await browser.close();
    return;
  }

  // === COPY COOKIES TO ANALYTICS ===
  console.log("🍪 Extracting session cookies...");
  const cookies = await page.cookies();
  if (!cookies.length) {
    console.warn("⚠️ No cookies found — session may not persist.");
  }

  console.log("📊 Navigating to analytics...");
  const analyticsPage = await browser.newPage();
  await analyticsPage.setViewport({ width: 1366, height: 768 });
  await analyticsPage.setCookie(...cookies);

  const captured = [];

  analyticsPage.on("request", (req) => {
    const url = req.url();
    if (url.includes("QueryExecutionService") && url.includes("/public/query")) {
      const auth = req.headers()["authorization"] || null;
      const postData = req.postData() || null;
      console.log("📡 Captured Power BI query:", url);
      captured.push({
        url,
        authorization: auth,
        body: postData,
        timestamp: new Date().toISOString(),
      });
    }
  });

  try {
    await analyticsPage.goto(ANALYTICS_URL, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });
    console.log("✅ Analytics page loaded.");
    await analyticsPage.screenshot({
      path: `screenshot-${Date.now()}-analytics.png`,
    });
  } catch (err) {
    console.error("⚠️ Analytics failed to load:", err.message);
    await analyticsPage.screenshot({
      path: `screenshot-${Date.now()}-analytics-error.png`,
    });
  }

  // === WAIT FOR NETWORK ACTIVITY ===
  console.log("🕵️ Monitoring Power BI traffic for 2 minutes...");
  await new Promise((r) => setTimeout(r, 120000));

  if (captured.length > 0) {
    fs.writeFileSync("powerbi-queries.json", JSON.stringify(captured, null, 2));
    console.log(`💾 Saved ${captured.length} Power BI query requests.`);
  } else {
    console.log("⚠️ No Power BI queries detected.");
  }

  await browser.close();
  console.log("✅ Done.");
}

deepCapture().catch((err) => console.error("❌ Error:", err));
