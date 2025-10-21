import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD, ANALYTICS_URL } = process.env;

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
  await client.send("Runtime.enable");

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
  client.on("Network.responseReceived", (p) => {
    const u = p.response.url;
    if (u.includes("pbidedicated.windows.net") || u.includes("powerbi.com")) {
      captured.push({
        type: "response",
        url: u,
        status: p.response.status,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // === STEP 1: COMPANY ID ===
  console.log("🌐 Navigating to Autocab365 login page...");
  await page.goto("https://portal.autocab365.com/#/login", {
    waitUntil: "domcontentloaded",
  });

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

  // === STEP 2: USERNAME + PASSWORD ===
  console.log("👤 Entering username...");
  await page.type("input[name='username']", USERNAME, { delay: 50 });

  console.log("🔐 Entering password...");
  await page.type("input[name='password']", PASSWORD, { delay: 50 });

  console.log("🖱️ Clicking Log In...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const loginBtn =
      btns.find((b) => /log in/i.test(b.innerText)) ||
      btns.find((b) => /login/i.test(b.innerText));
    if (loginBtn) loginBtn.click();
  });

  console.log("⏳ Waiting for portal redirect...");
  try {
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    console.log("✅ Logged in successfully!");
  } catch {
    console.warn("⚠️ Login may have succeeded silently — continuing...");
  }

  // === STEP 3: ANALYTICS ===
  console.log("📊 Navigating to analytics...");
  await page.goto(ANALYTICS_URL, { waitUntil: "networkidle2" });

  console.log("🕵️ Monitoring all network events for 2 minutes...");
  await new Promise((r) => setTimeout(r, 120000));

  console.log(`💾 Captured ${captured.length} Power BI network events`);
  fs.writeFileSync("deep-capture.json", JSON.stringify(captured, null, 2));

  await browser.close();
  console.log("✅ Done. Results saved to deep-capture.json");
}

deepCapture().catch((e) => console.error("❌ Error:", e));
