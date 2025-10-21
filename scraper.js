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
  await client.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

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

  // --- LOGIN SEQUENCE ---
  console.log("🌐 Navigating to Autocab365 login page...");
  await page.goto("https://portal.autocab365.com/#/login", { waitUntil: "domcontentloaded" });

  // Log existing inputs for debugging
  const inputs = await page.$$eval("input", els => els.map(e => e.name || e.id || e.placeholder));
  console.log("🔎 Found input fields:", inputs);

  // Type companyId if exists
  if (await page.$("input[name='companyId']")) {
    console.log("🏢 Entering company ID...");
    await page.type("input[name='companyId']", COMPANY_ID, { delay: 50 });
  }

  // Type username
  const userSel = (await page.$("input[name='username']")) || (await page.$("input#username"));
  if (userSel) {
    console.log("👤 Entering username...");
    await userSel.type(USERNAME, { delay: 50 });
  } else {
    console.warn("⚠️ Username field not found!");
  }

  // Type password
  const passSel = (await page.$("input[name='password']")) || (await page.$("input#password"));
  if (passSel) {
    console.log("🔐 Entering password...");
    await passSel.type(PASSWORD, { delay: 50 });
  } else {
    console.warn("⚠️ Password field not found!");
  }

  // Try clicking login / continue button
  const buttonSelectors = [
    "button[type='submit']",
    "button:has-text('Continue')",
    "button:has-text('Login')",
    "button:has-text('Log in')",
  ];
  let clicked = false;
  for (const sel of buttonSelectors) {
    const found = await page.$(sel);
    if (found) {
      console.log(`✅ Clicking ${sel}`);
      await found.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) console.warn("⚠️ No login button found, maybe automatic submit?");

  console.log("⏳ Waiting for navigation or analytics redirect...");
  try {
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
  } catch {
    console.warn("⚠️ Navigation timeout — continuing anyway");
  }

  // --- ANALYTICS ---
  console.log("📊 Navigating to analytics...");
  await page.goto(ANALYTICS_URL, { waitUntil: "networkidle2" });

  console.log("🕵️ Monitoring all network events for 2 minutes...");
  await new Promise(r => setTimeout(r, 120000));

  console.log(`💾 Captured ${captured.length} Power BI network events`);
  fs.writeFileSync("deep-capture.json", JSON.stringify(captured, null, 2));
  await browser.close();
  console.log("✅ Done. Results saved to deep-capture.json");
}

deepCapture().catch(e => console.error("❌ Error:", e));
