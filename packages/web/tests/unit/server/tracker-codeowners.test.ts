import { describe, expect, it } from "vitest";
import { ownerOfFiles, parseCodeowners } from "../../../src/server/tracker/codeowners.js";

const rules = parseCodeowners(`
# everything
*                      @core
*.md                   @docs
/packages/web/         @hal @ryan
packages/rex/src/**/*.ts @rex-team  # trailing comment
/packages/web/vendor/
`);

describe("ownerOfFiles", () => {
  it("lets the last matching rule win and names its first owner", () => {
    expect(ownerOfFiles(rules, ["packages/web/src/a.ts"])).toBe("@hal");
    expect(ownerOfFiles(rules, ["README.md"])).toBe("@docs");
    expect(ownerOfFiles(rules, ["scripts/x.mjs"])).toBe("@core");
  });

  it("matches ** across directories and a slashless pattern at any depth", () => {
    expect(ownerOfFiles(rules, ["packages/rex/src/a/b/c.ts"])).toBe("@rex-team");
    expect(ownerOfFiles(rules, ["docs/deep/guide.md"])).toBe("@docs");
  });

  it("matches a leading **/ at the root and ? as one character", () => {
    const more = parseCodeowners("*  @core\n**/build.mjs  @build\nv?.txt  @v\n");
    expect(ownerOfFiles(more, ["build.mjs"])).toBe("@build");
    expect(ownerOfFiles(more, ["scripts/deep/build.mjs"])).toBe("@build");
    expect(ownerOfFiles(more, ["v1.txt"])).toBe("@v");
    expect(ownerOfFiles(more, ["v12.txt"])).toBe("@core");
  });

  it("treats a rule with no owner as un-owning its paths", () => {
    expect(ownerOfFiles(rules, ["packages/web/vendor/x.js"])).toBeUndefined();
  });

  it("takes the first file that has an owner, and none for no rules or no files", () => {
    expect(ownerOfFiles(rules, ["packages/web/vendor/x.js", "README.md"])).toBe("@docs");
    expect(ownerOfFiles([], ["a.ts"])).toBeUndefined();
    expect(ownerOfFiles(rules, [])).toBeUndefined();
  });
});
