import { describe, it, expect } from "vitest";
import { parseArgs } from "../../../src/cli/parse-args.js";

describe("parseArgs: --blocked-by", () => {
  it("maps --blocked-by to blockedBy", () => {
    expect(parseArgs(["add", "--blocked-by=t1"]).flags.blockedBy).toBe("t1");
    expect(parseArgs(["add", "--blocked-by=t1,t2"]).flags.blockedBy).toBe("t1,t2");
  });

  it("accumulates repeated flags, mixing spellings", () => {
    const { flags } = parseArgs(["add", "--blocked-by=t1", "--blocked-by", "t2,t3", "--blockedBy=t4"]);
    expect(flags.blockedBy).toBe("t1,t2,t3,t4");
  });

  it("keeps --blockedBy working", () => {
    expect(parseArgs(["update", "id", "--blockedBy=t1"]).flags.blockedBy).toBe("t1");
  });

  it("keeps an empty value so update can clear", () => {
    expect(parseArgs(["update", "id", "--blocked-by="]).flags.blockedBy).toBe("");
  });

  it("leaves the positional dir alone after a space-separated value", () => {
    const parsed = parseArgs(["add", "--blocked-by", "t1", "."]);
    expect(parsed.flags.blockedBy).toBe("t1");
    expect(parsed.positional).toEqual(["."]);
  });
});
