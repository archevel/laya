// Loads the page in a separate Chrome with WebGPU flags, runs the default example, prints log + answers.
// usage: node browser-test.mjs [url]     (VK_ICD_FILENAMES=... picks the GPU, as in kattbilder's README)
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:8091/?model=local";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/run/current-system/sw/bin/google-chrome-stable",
  headless: "new",
  args: ["--enable-features=Vulkan", "--use-angle=vulkan", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"],
});
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text()); });
await page.goto(url);
// First visit: the page asks before downloading; accept.
await page.waitForSelector("#gate:not([hidden]) #gate-btn:not([hidden]), #run:not([disabled])", { timeout: 60000 });
if (await page.$("#gate:not([hidden]) #gate-btn")) await page.click("#gate-btn");
await page.waitForFunction(() => !document.getElementById("run").disabled || /failed|Could not/.test(document.getElementById("status").textContent), { timeout: 300000 });
for (let i = 0; i < 3; i++) {
  await page.click("#run");
  await page.waitForFunction(() => document.getElementById("run").textContent === "Ask" && document.querySelector("#results .meta, #results .error"), { timeout: 300000 });
}
console.log(await page.$eval("#log", (e) => e.textContent));
console.log(await page.$eval("#results", (e) => e.innerText));
await browser.close();
