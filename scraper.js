import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD } = process.env;
const ANALYTICS_URL = "https://analytics.autocab365.com/";

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (deep capture mode)...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.goto("https://portal.autocab365.com/#/login", {
    waitUntil: "domcontentloaded",
  });

  console.log("🏢 Entering company ID...");
  await page.waitForSelector("input[name='companyId']", { timeout: 15000 });
  await page.type("input[name='companyId']", COMPANY_ID, { delay: 50 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
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
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /log\s?in/i.test(b.innerText)
    );
    if (btn) btn.click();
  });

  console.log("⏳ Waiting for portal dashboard (# in URL)...");
  await page.waitForFunction(() => window.location.href.includes("#/"), {
    timeout: 60000,
  });
  console.log("✅ Logged in and on dashboard!");

  // === STEP 2: Extract MWCToken from localStorage ===
  console.log("🔍 Extracting MWCToken from localStorage...");
  const token = await page.evaluate(() => localStorage.getItem("MWCToken"));
  if (!token) {
    console.error("❌ No MWCToken found in localStorage!");
    await browser.close();
    return;
  }
  console.log("✅ MWCToken found:", token.substring(0, 40) + "...");

  // === STEP 3: Open analytics with Authorization header ===
  console.log("📊 Opening analytics.autocab365.com with auth header...");
  const analyticsPage = await browser.newPage();
  await analyticsPage.setExtraHTTPHeaders({
    Authorization: `MWCToken ${token}`,
  });

  // Track Power BI requests
  const client = await analyticsPage.target().createCDPSession();
  await client.send("Network.enable");
  let captured = [];
  client.on("Network.requestWillBeSent", (params) => {
    const u = params.request.url;
    if (
      u.includes("pbidedicated.windows.net") ||
      u.includes("powerbi.com") ||
      u.includes("QueryExecutionService")
    ) {
      captured.push({
        url: u,
        method: params.request.method,
        headers: params.request.headers,
        body: params.request.postData || null,
        timestamp: new Date().toISOString(),
      });
    }
  });

  await analyticsPage.goto(ANALYTICS_URL, { waitUntil: "networkidle2" });

  console.log("⏳ Waiting 2 minutes for Power BI traffic...");
  await new Promise((r) => setTimeout(r, 120000));

  console.log(`💾 Captured ${captured.length} Power BI network events`);
  fs.writeFileSync("deep-capture.json", JSON.stringify(captured, null, 2));

  await browser.close();
  console.log("✅ Done. Results saved to deep-capture.json");
}

deepCapture().catch((err) => {
  console.error("❌ Error:", err);
});
