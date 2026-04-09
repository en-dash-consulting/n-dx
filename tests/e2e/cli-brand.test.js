/**
 * Visual regression snapshot for the ndx init dinosaur ASCII art.
 *
 * Any character-level change to the mascot requires an explicit snapshot
 * update (`pnpm vitest --update`), making regressions visible in review.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getMascot, getMascotFrames, resetColorCache } from "../../packages/core/cli-brand.js";

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
"          ▗████▖
         ▗████▜▝
         ▟████▛▘
        ▟█████▌
 ▜▖  ▗▟████████▌
 ▐████████████▛▘
 ▝▜███████████▘
   ▝▜███▘  ▜██▀
      ▐▌    ▐▌"
`);
  });

  it("all animation frames match committed snapshots", () => {
    const frames = getMascotFrames();
    expect(frames).toHaveLength(2);

    // Frame 0 — reference: packages/rex/Rex-F.png (feet lifted, ▐▌ open form)
    expect(frames[0]).toMatchInlineSnapshot(`
"          ▗████▖
         ▗████▜▝
         ▟████▛▘
        ▟█████▌
 ▜▖  ▗▟████████▌
 ▐████████████▛▘
 ▝▜███████████▘
   ▝▜███▘  ▜██▀
      ▐▌    ▐▌"
`);

    // Frame 1 — reference: packages/rex/Rex.png (left leg planted █, right leg in stride ▐▌)
    expect(frames[1]).toMatchInlineSnapshot(`
"          ▗████▖
         ▗████▜▝
         ▟████▛▘
        ▟█████▌
 ▜▖  ▗▟████████▌
 ▐████████████▛▘
 ▝▜███████████▘
   ▝▜███▘  ▜██▀
      █     ▐▌"
`);
  });
});
