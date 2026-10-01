// @vitest-environment jsdom
/**
 * `hubUrl()` is the viewer's only sanctioned way to address the hub chooser.
 *
 * It exists because the obvious call — `appUrl("/hub")` — is wrong: every
 * other root-relative URL the viewer builds belongs to its own project server
 * and must carry the base path, while the chooser sits above every project and
 * must not. These tests pin that difference, since the two helpers read alike
 * at the call site.
 */

import { afterEach, describe, expect, it } from "vitest";
import { appUrl, hubUrl, setBasePathForTests } from "../../../src/viewer/base-path.js";
import { HUB_PATH } from "../../../src/shared/index.js";

afterEach(() => setBasePathForTests(null));

describe("hubUrl", () => {
  it("is the same absolute path from every base path", () => {
    for (const basePath of ["", "/p/caos", "/w/feature", "/p/caos/w/feature"]) {
      setBasePathForTests(basePath);
      expect(hubUrl(), basePath).toBe(HUB_PATH);
    }
  });

  it("is not what appUrl would build, which is the reason it exists", () => {
    setBasePathForTests("/p/caos/w/feature");
    expect(appUrl(HUB_PATH)).toBe("/p/caos/w/feature/hub");
    expect(hubUrl()).toBe("/hub");
  });
});
