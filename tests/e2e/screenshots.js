// Re-creates the README screenshots against an instance that has demo samples and a finished run.
// scripts/e2e.sh --screenshots prepares such an instance (a throw-away one, not the one you work in) and runs this.
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:8000";
const OUT = process.env.OUT_DIR || "/out";
(async () => {
  const browser = await chromium.launch();
  const plan = { data: ["config", "recording", "datasets", "storage"], train: ["training", "jobs"], test: ["test"], deploy: ["deploy"] };
  const tabNames = { data: "Data", train: "Training", test: "Test", deploy: "Deploy" };
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: scheme, locale: "en-US", deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#data`, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    if (scheme === "dark") {
      await page.screenshot({ path: `${OUT}/hero-dark.png` });
      await page.getByRole("tab", { name: "Training" }).click();
      await page.waitForTimeout(1500);
      await page.addStyleTag({ content: ".MuiAppBar-root{display:none}" });
      await page.locator(".MuiCard-root").nth(0).screenshot({ path: `${OUT}/training-dark.png` });
      await ctx.close();
      continue;
    }
    await page.screenshot({ path: `${OUT}/hero-light.png` });
    for (const [tab, names] of Object.entries(plan)) {
      await page.getByRole("tab", { name: tabNames[tab] }).click();
      await page.waitForTimeout(2000);
      if (tab === "data") await page.getByRole("button", { name: /^QR code$/i }).click().catch(() => undefined);
      if (tab === "train") await page.getByRole("button", { name: /Training log/i }).click().catch(() => undefined);
      if (tab === "deploy") await page.getByRole("button", { name: /Example ESPHome YAML/i }).click().catch(() => undefined);
      if (tab === "test") {
        const slider = page.locator('input[type="range"]').first();
        await slider.focus();
        for (let k = 0; k < 30; k++) await slider.press("ArrowLeft");
        await page.getByRole("button", { name: /Evaluate on recordings/i }).click();
        await page.waitForTimeout(8000);
      }
      await page.addStyleTag({ content: ".MuiAppBar-root{display:none}" });
      const cards = page.locator(".MuiCard-root");
      for (let i = 0; i < names.length; i++) await cards.nth(i).screenshot({ path: `/out/${names[i]}.png` });
      await page.addStyleTag({ content: ".MuiAppBar-root{display:flex}" });
    }
    await ctx.close();
  }
  await browser.close();
})();
