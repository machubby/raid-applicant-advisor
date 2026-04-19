const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const artifacts = path.join(root, "artifacts");

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("http://127.0.0.1:4177", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.querySelector("#currentRoster").value = window.RAID_DATA.demoRoster;
    document.querySelector("#applicants").value = window.RAID_DATA.demoApplicants;
    document.querySelector("#currentRoster").dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(".recommendation-card").first().waitFor();
  await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });

  const selected = await page.locator(".recommendation-card").count();
  const buffItems = await page.locator(".buff-item").count();
  const raidSlots = await page.locator(".raid-slot").count();
  const title = await page.locator("h1").innerText();

  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: path.join(artifacts, "mobile.png"), fullPage: true });

  await browser.close();

  if (title !== "Raid Applicant Advisor") {
    throw new Error(`Unexpected title: ${title}`);
  }

  if (selected < 1) {
    throw new Error("Expected at least one recommendation.");
  }

  if (buffItems < 10) {
    throw new Error("Expected buff coverage rows.");
  }

  if (raidSlots !== 20) {
    throw new Error(`Expected 20 raid slots for demo comp, saw ${raidSlots}.`);
  }

  if (consoleErrors.length) {
    throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);
  }

  console.log(`Smoke OK: ${selected} recommendations, ${buffItems} buffs, ${raidSlots} slots.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
