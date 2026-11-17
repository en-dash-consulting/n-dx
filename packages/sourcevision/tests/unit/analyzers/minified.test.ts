import { describe, expect, it } from "vitest";
import {
  hasMinifiedLine,
  isMinifiedFile,
  isMinifiedName,
  MINIFIED_HEAD_BYTES,
  MINIFIED_LINE_CHARS,
} from "../../../src/analyzers/minified.js";
import { classifyRole } from "../../../src/analyzers/inventory.js";
import { phpConfig } from "@n-dx/lang-kit";

describe("isMinifiedName", () => {
  it.each([
    "public/js/jquery.min.js",
    "lib/x.min.mjs",
    "css/site.min.css",
    "js/jquery-min.js",
    "dist2/app.bundle.js",
    "js/app.js.map",
    "css/site.css.map",
    "JS/APP.MIN.JS",
  ])("matches %s", (path) => expect(isMinifiedName(path)).toBe(true));

  it.each(["src/admin.js", "src/min.js", "src/minify.ts", "src/app.mjs", "src/map.js", "src/bundle.ts"])(
    "leaves %s alone",
    (path) => expect(isMinifiedName(path)).toBe(false),
  );
});

describe("hasMinifiedLine", () => {
  it("is true only past the line limit", () => {
    expect(hasMinifiedLine("a".repeat(MINIFIED_LINE_CHARS))).toBe(false);
    expect(hasMinifiedLine("a".repeat(MINIFIED_LINE_CHARS + 1))).toBe(true);
    expect(hasMinifiedLine(`short\n${"a".repeat(MINIFIED_LINE_CHARS + 1)}\nshort\n`)).toBe(true);
  });

  it("reads only the head", () => {
    const lines = "x\n".repeat(MINIFIED_HEAD_BYTES / 2);
    expect(hasMinifiedLine(Buffer.from(lines + "a".repeat(MINIFIED_LINE_CHARS + 1)))).toBe(false);
  });
});

describe("isMinifiedFile", () => {
  const long = "a".repeat(MINIFIED_LINE_CHARS + 1);
  it("checks content of JS and CSS only", () => {
    expect(isMinifiedFile("js/plugins.js", long)).toBe(true);
    expect(isMinifiedFile("css/theme.css", long)).toBe(true);
    expect(isMinifiedFile("src/data.php", long)).toBe(false);
    expect(isMinifiedFile("js/plugins.js")).toBe(false);
  });
});

describe("classifyRole and minified files", () => {
  it("makes a minified file generated in any repository, ahead of asset and source", () => {
    expect(classifyRole("public/js/jquery.min.js", "JavaScript", phpConfig)).toBe("generated");
    expect(classifyRole("js/app.min.js", "JavaScript", phpConfig)).toBe("generated");
    expect(classifyRole("theme/js/plugins.js", "JavaScript", phpConfig, undefined, true)).toBe("generated");
    expect(classifyRole("theme/js/plugins.js", "JavaScript", phpConfig)).toBe("source");
  });

  it("keeps a minified test fixture a test", () => {
    expect(classifyRole("src/__tests__/fixture.min.js", "JavaScript")).toBe("test");
  });
});
