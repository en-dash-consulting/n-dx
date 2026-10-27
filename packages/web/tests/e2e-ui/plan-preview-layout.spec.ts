/**
 * Plan page after a capture Preview — layout.
 *
 * Regression coverage for a sideways scroll: on a narrow window (the Claude
 * desktop browser pane is 1,024px) pressing Preview in Plan's capture bar made
 * the page wider than the viewport, cutting off its left edge. The page must
 * not scroll sideways, the preview card must sit inside its container, and a
 * long change title must wrap rather than run past the card.
 *
 * The preview response is mocked: the layout does not depend on a v2 tree, and
 * no model call is needed.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboard,
  type FixtureProject,
  type RunningDashboard,
} from "./helpers/fixture-project.js";

const LONG_TITLE =
  "Shoppers paying by card want refunds they can start themselves from the order page without contacting support";
const LONG_TARGET = "Refund requests initiated by the paying customer from the order history page, card payments only";

const PREVIEW = {
  preview: true,
  proposals: [],
  confidence: 0,
  qualityIssues: [],
  changes: [
    {
      id: "01J9CHANGE0000000000000000",
      type: "change",
      title: LONG_TITLE,
      description: `${LONG_TITLE}.\n\nRefunds go back to the same card.`,
      needsPlacement: true,
      placement: {
        relation: "amends",
        shortlist: [
          { target: "01J9CAP00000000000000000000", relation: "amends", title: LONG_TARGET, displayId: "A1.1" },
        ],
      },
    },
  ],
};

let fixture: FixtureProject;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = await createFixtureProject();
  dashboard = await startDashboard(fixture.dir);
});

test.afterAll(async () => {
  stopDashboard(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

async function previewAt(page: Page, width: number): Promise<void> {
  await page.route("**/api/rex/smart-add-preview", (route) =>
    route.fulfill({ json: PREVIEW }),
  );
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${dashboard.baseUrl}/plan`, { waitUntil: "domcontentloaded" });
  const bar = page.locator(".smart-add-textarea");
  await bar.fill(LONG_TITLE);
  await page.locator(".smart-add-btn-generate").click();
  await expect(page.locator(".smart-add-preview-card")).toBeVisible({ timeout: 15_000 });
}

for (const width of [1024, 768]) {
  test(`the Plan page does not scroll sideways after a Preview at ${width}px`, async ({ page }) => {
    await previewAt(page, width);

    const widths = await page.evaluate(() => {
      // Elements whose box ends past the viewport: the culprit, named for the failure message.
      const wide = [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className} right=${Math.round(el.getBoundingClientRect().right)}`);
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        scrollX: window.scrollX,
        main: (document.querySelector(".main") as HTMLElement).scrollWidth,
        mainClient: (document.querySelector(".main") as HTMLElement).clientWidth,
        wide,
      };
    });
    expect(widths.document, `past the viewport: ${widths.wide.join("; ")}`).toBeLessThanOrEqual(widths.viewport);
    expect(widths.main, `wider than .main: ${widths.wide.join("; ")}`).toBeLessThanOrEqual(widths.mainClient);
    expect(widths.scrollX).toBe(0);
  });

  test(`the preview card fits its container and wraps a long title at ${width}px`, async ({ page }) => {
    await previewAt(page, width);

    const card = page.locator(".smart-add-preview-card");
    const panel = page.locator(".smart-add-panel");
    const [cardBox, panelBox] = await Promise.all([card.boundingBox(), panel.boundingBox()]);
    expect(cardBox!.x).toBeGreaterThanOrEqual(panelBox!.x - 1);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);

    // Nothing inside the card is clipped: every text node's box is within it.
    const clipped = await card.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("*")]
        .filter((c) => c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().right > el.getBoundingClientRect().right + 1)
        .map((c) => c.className),
    );
    expect(clipped).toEqual([]);

    // The title wraps: it is taller than one line.
    const title = page.locator(".smart-add-preview-title");
    const fontSize = await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect((await title.boundingBox())!.height).toBeGreaterThan(fontSize * 2);
  });
}
