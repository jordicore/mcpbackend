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
  const client = await page.target().createCDPSession();

  await client.send("Network.enable");
  await client.send("Page.enable");

  // Track Power BI requests
  let captured = [];
  client.on("Network.requestWillBeSent", (p) => {
    const u = p.request.url;
    if (u.includes("pbidedicated.windows.net") || u.includes("powerbi.com")) {
      captured.push({
        type: "request",
        url: u,
        method: p.request.method,
        body: p.request.postData || null,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // === STEP 1: LOGIN ===
  console.log("🌐 Navigating to Autocab365 login page...");
  await page.goto("https://portal.autocab365.com/#/login", { waitUntil: "domcontentloaded" });

  console.log("🏢 Entering company ID...");
  await page.waitForSelector("input[name='companyId']", { timeout: 15000 });
  await page.type("input[name='companyId']", COMPANY_ID, { delay: 50 });

  console.log("➡️ Clicking Continue...");
  await page.evaluate(() => {
    const btn = document.querySelector("button, input[type='submit']");
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
    const btns = Array.from(document.querySelectorAll("button"));
    const loginBtn = btns.find((b) => /log in/i.test(b.innerText));
    if (loginBtn) loginBtn.click();
  });

  console.log("⏳ Waiting for portal dashboard (# in URL)...");
  await page.waitForFunction(() => window.location.href.includes("#/"), { timeout: 60000 });
  console.log("✅ Logged in and on dashboard!");

  // === STEP 2: TRANSFER SESSION TO ANALYTICS ===
  console.log("🍪 Extracting cookies from portal...");
  const cookies = await page.cookies();
  console.log(`🍪 Retrieved ${cookies.length} cookies.`);

  console.log("🆕 Opening new tab for analytics...");
  const analyticsPage = await browser.newPage();

  // Convert cookies for analytics domain
  const updatedCookies = cookies.map((c) => ({
    ...c,
    domain: ".autocab365.com", // allow cross-subdomain
  }));
  await analyticsPage.setCookie(...updatedCookies);
  console.log("✅ Cookies transferred to analytics.autocab365.com");

  console.log("📊 Navigating to analytics...");
  await analyticsPage.goto(ANALYTICS_URL, { waitUntil: "networkidle2" });

  console.log("🕵️ Monitoring Power BI traffic for 2 minutes...");
  const analyticsClient = await analyticsPage.target().createCDPSession();
  await analyticsClient.send("Network.enable");

  analyticsClient.on("Network.requestWillBeSent", (p) => {
    const u = p.request.url;
    if (u.includes("pbidedicated.windows.net") || u.includes("powerbi.com")) {
      captured.push({
        type: "request",
        url: u,
        method: p.request.method,
        body: p.request.postData || null,
        timestamp: new Date().toISOString(),
      });
    }
  });

  await new Promise((r) => setTimeout(r, 120000));

  console.log(`💾 Captured ${captured.length} Power BI network events`);
  fs.writeFileSync("deep-capture.json", JSON.stringify(captured, null, 2));

  await browser.close();
  console.log("✅ Done. Results saved to deep-capture.json");
}

deepCapture().catch((e) => console.error("❌ Error:", e));
