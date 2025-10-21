import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { USERNAME, PASSWORD, ANALYTICS_URL } = process.env;

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (deep capture mode)...");
  const browser = await puppeteer.launch({
    headless: true,
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
  client.on("Network.requestWillBeSent", (params) => {
    if (
      params.request.url.includes("pbidedicated.windows.net") ||
      params.request.url.includes("powerbi.com")
    ) {
      captured.push({
        type: "request",
        url: params.request.url,
        method: params.request.method,
        body: params.request.postData || null,
        timestamp: new Date().toISOString(),
      });
    }
  });

  client.on("Network.responseReceived", (params) => {
    if (
      params.response.url.includes("pbidedicated.windows.net") ||
      params.response.url.includes("powerbi.com")
    ) {
      captured.push({
        type: "response",
        url: params.response.url,
        status: params.response.status,
        timestamp: new Date().toISOString(),
      });
    }
  });

  console.log("🌐 Navigating to Autocab365 login page...");
  await page.goto("https://portal.autocab365.com/", { waitUntil: "networkidle2" });

  console.log("🔑 Entering credentials...");
  await page.type("#username", USERNAME, { delay: 50 });
  await page.click("button[type='submit'], button:has-text('Continue')");
  await page.waitForSelector("#password", { timeout: 15000 });
  await page.type("#password", PASSWORD, { delay: 50 });
  await page.keyboard.press("Enter");

  console.log("⏳ Waiting for login success...");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });

  console.log("📊 Navigating to analytics...");
  await page.goto(ANALYTICS_URL, { waitUntil: "networkidle2" });

  console.log("🕵️ Monitoring all network events for 2 minutes...");
  await new Promise((r) => setTimeout(r, 120000));

  console.log(`💾 Captured ${captured.length} Power BI network events`);
  fs.writeFileSync("deep-capture.json", JSON.stringify(captured, null, 2));

  await browser.close();
  console.log("✅ Done. Results saved to deep-capture.json");
}

deepCapture().catch((err) => console.error("❌ Error:", err));
