// Playwright smoke test: every tab renders its cards and the contributor page rejects a bad token.
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:8000";

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const page = await browser.newPage({ locale: "en-US", permissions: ["microphone"] });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector(".MuiCard-root", { timeout: 20000 });
  const expected = {
    Data: ["Wake word", "Sample recording", "Negative datasets", "Storage use"],
    Training: ["Model training", "Training settings", "Trained models"],
    Test: [],
    Deploy: ["Deploy the model"],
  };
  let cards = 0;
  for (const [tab, titles] of Object.entries(expected)) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    for (const title of titles) {
      if (!text.includes(title)) throw new Error(`Tab ${tab}: missing card ${title}`);
    }
    cards += await page.locator(".MuiCard-root").count();
  }
  // the step bar, the empty state of a project without a model (or the test card of one with a model)
  if ((await page.locator(".MuiStepper-root .MuiStep-root").count()) !== 4) throw new Error("Step bar missing");
  await page.getByRole("tab", { name: "Test" }).click();
  await page.waitForTimeout(800);
  const testText = await page.locator("body").innerText();
  if (!testText.includes("No trained model yet") && !testText.includes("Test the model")) throw new Error("Test tab shows neither the empty state nor the test card");
  // the microphone test dialog opens and closes
  await page.getByRole("tab", { name: "Data" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Microphone test" }).first().click();
  await page.waitForTimeout(800);
  if (!(await page.getByRole("dialog").innerText()).includes("Microphone and room test")) throw new Error("Microphone test dialog did not open");
  await page.keyboard.press("Escape");
  // a take whose upload fails waits in the browser and can be uploaded once the server answers again
  await page.route("**/api/recordings", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await page.keyboard.press("Space");
  await page.getByText("Recording…").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  if (await page.getByText("Recording…").isVisible().catch(() => false)) await page.keyboard.press("Space");
  await page.getByText("waiting in this browser: 1").waitFor({ timeout: 15000 });
  await page.reload({ waitUntil: "load" }); // the take survives a reload
  await page.getByText("waiting in this browser: 1").waitFor({ timeout: 15000 });
  await page.unroute("**/api/recordings");
  await page.getByRole("button", { name: "Upload now" }).click();
  await page.getByText("waiting in this browser").waitFor({ state: "hidden", timeout: 15000 });
  await page.goto(`${BASE}/contribute?token=invalid`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const contributeText = await page.locator("body").innerText();
  if (!/not valid/i.test(contributeText)) throw new Error("Contributor page did not reject an invalid token");
  if (errors.length) throw new Error(`Page errors: ${errors.join("; ")}`);
  console.log(`OK: ${cards} cards rendered across 4 tabs, a failed upload is kept and recovered, contributor page guarded`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
