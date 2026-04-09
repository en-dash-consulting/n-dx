/**
 * Visual regression snapshot for the ndx init dinosaur ASCII art.
 *
 * Any character-level change to the mascot requires an explicit snapshot
 * update (`pnpm vitest --update`), making regressions visible in review.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getMascot, resetColorCache } from "../../packages/core/cli-brand.js";

describe("ndx init dinosaur ASCII art", () => {
  let savedNoColor;

  beforeEach(() => {
    savedNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    resetColorCache();
  });

  afterEach(() => {
    if (savedNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = savedNoColor;
    }
    resetColorCache();
  });

  it("mascot matches committed snapshot", () => {
    expect(getMascot()).toMatchInlineSnapshot(`
"       ▗████
       ▐▙▄██
       ▟██▛▝
      ▟███▖
 ▜▄ ▗▟████▌
  ▜███████▟▘
   ▜█████▀▘
    ▜██▀
    ▟▘ ▜▖"
`);
  });
});
