import { test, expect } from "@playwright/test";

test("integrated showcase renders animated characters, switches scenes and cleans up", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/examples/browser-smoke.html");
  const characters = page.locator("#character-layer .qarton-character");
  await expect(characters).toHaveCount(2, { timeout: 15_000 });

  const hero = page.locator('[data-character-id="hero"]');
  const heroImage = hero.locator("img");
  await expect(heroImage).toHaveAttribute("src", /^data:image\/svg\+xml,/);

  // Wait until the controller enters its moving state, then verify that
  // the real browser keeps sampling the composed character pose.
  await expect(hero).toHaveAttribute("data-state", "moving", { timeout: 3_000 });
  const initialTransform = await hero.evaluate(element => element.style.transform);
  await page.waitForTimeout(250);
  await expect.poll(() => hero.evaluate(element => element.style.transform), { timeout: 2_000 })
    .not.toBe(initialTransform);

  await page.getByRole("button", { name: "Scene: Dusk" }).click();
  await expect(page.locator("#status")).toContainText("Scene dusk active", { timeout: 5_000 });
  await expect(characters).toHaveCount(2);

  await page.getByRole("button", { name: "Destroy runtime" }).click();
  await expect(page.locator("#status")).toContainText("Destroyed:", { timeout: 5_000 });
  await expect(characters).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
