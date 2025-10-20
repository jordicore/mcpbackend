import puppeteer from "puppeteer";
import "dotenv/config";

const AUTOCAB_USER = process.env.AUTOCAB_USER || process.env.USERNAME;
const AUTOCAB_PASS = process.env.AUTOCAB_PASS || process.env.PASSWORD;
const COMPANY_ID = process.env.COMPANY_ID;
const ANALYTICS_URL = process.env.ANALYTICS_URL || "https://analytics.autocab365.com";

if (!AUTOCAB_USER || !AUTOCAB_PASS || !COMPANY_ID) {
  console.error("❌ Missing required environment variables in .env");
  process.exit(1);
}

(async () => {
  console.log("🚀 Launching Puppeteer...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    console.log("🌐 Navigating to Autocab365 login page...");
    await page.goto("https://portal.autocab365.com/#/login", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    console.log("🔑 Entering credentials...");
    await page.waitForSelector("input[name='companyId']", { timeout: 30000 });
    await page.type("input[name='companyId']", COMPANY_ID, { delay: 50 });

    await page.waitForSelector("input[name='username']");
    await page.type("input[name='username']", AUTOCAB_USER, { delay: 50 });

    await page.waitForSelector("input[name='password']");
    await page.type("input[name='password']", AUTOCAB_PASS, { delay: 50 });

    // --- Find and click the Continue/Login button safely ---
    const buttons = await page.$$("button");
    let continueBtn = null;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.innerText?.trim(), btn);
      if (text && text.toLowerCase().includes("continue")) {
        continueBtn = btn;
        break;
      }
    }

    if (continueBtn) {
      await continueBtn.click();
      console.log("✅ Clicked 'Continue...' button");
    } else {
      const submitBtn = await page.$("button[type='submit']");
      if (submitBtn) {
        await submitBtn.click();
        console.log("✅ Clicked generic 'Submit' button");
      } else {
        throw new Error("No Continue/Login button found");
      }
    }

    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    console.log("✅ Logged in successfully!");

    // --- Navigate to analytics ---
    console.log("📊 Navigating to analytics...");
    await page.goto(ANALYTICS_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // --- Start capturing requests ---
    const capturedEvents = [];
    console.log("⏳ Waiting 120 s for Power BI queries...");

    page.on("request", req => {
      const url = req.url();
      if (url.includes("pbidedicated.windows.net/webapi")) {
        capturedEvents.push({
          type: "request",
          url,
          method: req.method(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    page.on("response", res => {
      const url = res.url();
      if (url.includes("pbidedicated.windows.net/webapi")) {
        capturedEvents.push({
          type: "response",
          url,
          status: res.status(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Wait to capture Power BI requests
    await new Promise(resolve => setTimeout(resolve, 120000));

    console.log(`💾 Saved ${capturedEvents.length} Power BI network events`);
    console.log(JSON.stringify(capturedEvents, null, 2));

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await browser.close();
  }
})();
