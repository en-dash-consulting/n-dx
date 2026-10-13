import { describe, expect, it } from "vitest";
import { LANG_TERRAFORM_PACKAGE } from "../../src/index.js";

describe("@n-dx/lang-terraform barrel", () => {
  it("exports the package name", () => {
    expect(LANG_TERRAFORM_PACKAGE).toBe("@n-dx/lang-terraform");
  });
});
