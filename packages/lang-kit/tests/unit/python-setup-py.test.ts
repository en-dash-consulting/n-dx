import { describe, expect, it } from "vitest";

import { readSetupCall } from "../../src/python-setup-py.js";

describe("readSetupCall", () => {
  it.each(["setup(name='x' ])\n", "setup(\n  name='x',\n  }\n)\n", "setup(]"])("reports an unbalanced closer instead of looping: %j", (src) => {
    expect(readSetupCall(src)).toEqual({ notice: expect.stringMatching(/^line \d+: unbalanced '[\]}]' in setup\(\.\.\.\)$/) });
  });

  it("still reads balanced brackets inside a non-literal argument", () => {
    const call = readSetupCall("setup(name='x', cmdclass={k: v for k, v in [(1, 2)]}, packages=['a'])\n");
    expect("notice" in call).toBe(false);
    if (!("notice" in call)) expect(call.keywords.get("packages")?.value).toEqual(["a"]);
  });
});
