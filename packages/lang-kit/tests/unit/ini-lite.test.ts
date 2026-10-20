import { describe, expect, it } from "vitest";

import { parseIni } from "../../src/ini-lite.js";

describe("parseIni", () => {
  it("reads sections, both separators, continuation lines and comments", () => {
    const doc = parseIni(
      "# top\n[metadata]\nName = demo\nurl: https://x.org/a=b\n\n[options]\ninstall_requires =\n    a>=1\n    # skipped\n\n    b\npackages = find:\n; tail\n",
    );
    expect(doc.notices).toEqual([]);
    expect(doc.sections.get("metadata")?.get("name")).toEqual({ value: "demo", line: 3, lines: [{ text: "demo", line: 3 }] });
    expect(doc.sections.get("metadata")?.get("url")?.value).toBe("https://x.org/a=b");
    expect(doc.sections.get("options")?.get("install_requires")).toEqual({
      value: "\na>=1\n\nb",
      line: 7,
      lines: [
        { text: "a>=1", line: 8 },
        { text: "b", line: 11 },
      ],
    });
    expect(doc.sections.get("options")?.get("packages")?.value).toBe("find:");
  });

  it("turns lines it cannot place into notices and keeps reading", () => {
    const doc = parseIni("orphan = 1\n[open\nkey = v\n[ok]\nno separator\nk = v\n");
    expect(doc.notices).toEqual(["line 1: key outside any section", "line 2: section header is not closed", "line 3: key outside any section", "line 5: expected 'key = value'"]);
    expect(doc.sections.get("ok")?.get("k")?.value).toBe("v");
  });
});
