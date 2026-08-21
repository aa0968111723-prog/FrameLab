import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE", msg.text());
});
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));

async function shot(name, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(800);
  const path = `/workspace/screenshots/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log("wrote", path, "title=", await page.title(), "url=", page.url());
}

await shot("visual-home", "http://127.0.0.1:8080/");
await shot("visual-login", "http://127.0.0.1:8080/login");
await shot("visual-studio-gate", "http://127.0.0.1:8080/studio");

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 30000 });
await mobile.waitForTimeout(600);
await mobile.screenshot({ path: "/workspace/screenshots/visual-home-mobile.png" });
console.log("wrote mobile home");
await browser.close();
