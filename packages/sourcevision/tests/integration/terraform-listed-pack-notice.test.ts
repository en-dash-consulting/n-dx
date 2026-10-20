/**
 * A project that lists `terraform` in `sourcevision.packs` while the pack is
 * missing gets one Terraform notice per analyze, not one from the imports
 * phase and another from the infrastructure step. The missing pack is
 * simulated at the loader, as in terraform-infrastructure-model.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";

vi.mock("../../src/language/pack-loader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/language/pack-loader.js")>();
  const notInstalled = () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-terraform' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" }));
  const missing = (pack: { id: string }) => ({ ...pack, importByResolution: notInstalled });
  return {
    ...original,
    KNOWN_PACKS: original.KNOWN_PACKS.map((pack) => (pack.id === "terraform" ? missing(pack) : pack)),
    INSTALLABLE_PACKS: original.INSTALLABLE_PACKS.map((pack) => (pack.id === "terraform" ? missing(pack) : pack)),
  };
});

const BASE: Record<string, string> = {
  "package.json": "{}",
  ".n-dx.json": JSON.stringify({ sourcevision: { packs: ["terraform"] } }),
  "src/app.ts": 'export const queue = "orders-intake-queue";\n',
};

describe("analyze with terraform listed in sourcevision.packs and no pack", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
    vi.restoreAllMocks();
  });

  async function terraformNotices(extra: Record<string, string>): Promise<string[]> {
    dir = mkdtempSync(join(tmpdir(), "sv-tf-listed-"));
    for (const [rel, body] of Object.entries({ ...BASE, ...extra })) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(args.join(" ")));
    await cmdAnalyze(dir, ["--fast"]);
    return warnings.filter((w) => /terraform/i.test(w));
  }

  it("gives one notice when infrastructure.json lists a Terraform resource", async () => {
    const notices = await terraformNotices({
      "infra/main.tf": 'resource "aws_sqs_queue" "orders" {\n  name = "orders-intake-queue"\n}\n',
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^Terraform: pack @n-dx\/lang-terraform is not installed.*`ndx sv pack add terraform`/);
  }, 60_000);

  it("still gives the listed-pack notice once when .tf files declare no resource", async () => {
    const notices = await terraformNotices({ "infra/variables.tf": 'variable "x" {}\n' });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^sourcevision\.packs lists terraform: pack @n-dx\/lang-terraform is not installed.*`ndx sv pack add terraform`/);
  }, 60_000);

  it("gives the listed-pack notice once when there are no .tf files", async () => {
    const notices = await terraformNotices({});
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^sourcevision\.packs lists terraform:/);
  }, 60_000);
});
