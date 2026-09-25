// Screenshots the first-visit download prompt as a phone would see it.
// usage: node gate-shot.mjs url out.png [ios|android]
import puppeteer from "puppeteer-core";
const [url, out, kind = "ios"] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/run/current-system/sw/bin/google-chrome-stable", headless: "new",
  args: ["--enable-features=Vulkan", "--use-angle=vulkan", "--enable-unsafe-webgpu"],
});
const page = await browser.newPage();
await page.setUserAgent(kind === "ios"
  ? "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
  : "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36");
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(url);
await page.waitForSelector("#gate:not([hidden])", { timeout: 60000 });
console.log(await page.$eval("#gate", (e) => e.innerText));
console.log("page wider than viewport:", await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await page.screenshot({ path: out });
await browser.close();
