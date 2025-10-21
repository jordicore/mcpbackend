import puppeteer from "puppeteer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const { COMPANY_ID, USERNAME, PASSWORD } = process.env;

async function deepCapture() {
  console.log("🚀 Launching Puppeteer (universal iframe capture mode)...");
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

  // === POLL FOR IFRAMES ===
  console.log("🔎 Searching for Power BI iframes (up to 90 s)...");
  let iframeUrls = [];
  for (let i = 0; i < 18; i++) {
    iframeUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll("iframe"))
        .map(f => f.src)
        .filter(u => u && u.includes("app.powerbi.com/reportEmbed"))
    );
    if (iframeUrls.length > 0) break;
    await new Promise(r => setTimeout(r, 5000));
  }

  if (iframeUrls.length === 0) {
    console.log("⚠️  No Power BI iframes found after 90 s.");
    await browser.close();
    return;
  }

  console.log("✅ Found Power BI iframes:", iframeUrls);
  const captured = [];

  // === VISIT EACH IFRAME ===
  for (const url of iframeUrls) {
    console.log(`🌐 Opening ${url}`);
    const iframePage = await browser.newPage();
    const client = await iframePage.target().createCDPSession();
    await client.send("Network.enable");

    client.on("Network.requestWillBeSent", (params) => {
      const u = params.request.url;
      if (u.includes("pbidedicated.windows.net")) {
        captured.push({
          iframe: url,
          target: u,
          method: params.request.method,
          headers: params.request.headers,
          body: params.request.postData || null,
          timestamp: new Date().toISOString(),
        });
      }
    });

    try {
      await iframePage.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
      console.log("⏳ Monitoring traffic for 45 s...");
      await new Promise(r => setTimeout(r, 45000));
    } catch (e) {
      console.warn(`⚠️ Failed to load ${url}:`, e.message);
    }

    await iframePage.close();
  }

  fs.writeFileSync("deep-capture.json", JSON.stringify(captured, null, 2));
  console.log(`💾 Saved ${captured.length} Power BI network events`);
  await browser.close();
  console.log("✅ Done.");
}

deepCapture().catch(err => console.error("❌ Error:", err));
