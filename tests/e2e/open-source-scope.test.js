import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const document = readFileSync(join(root, "OPEN_SOURCE_SCOPE.md"), "utf8");
const included = document.split("## Included components")[1]?.split("Also included")[0] ?? "";
const rows = included.split("\n").filter((line) => line.startsWith("| `packages/")).map((line) => {
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", ""));
  return { path: cells[0], name: cells[1], license: cells[2] };
});
const published = readdirSync(join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
  let metadata;
  try { metadata = JSON.parse(readFileSync(join(root, "packages", entry.name, "package.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return metadata.private ? [] : [{ path: `packages/${entry.name}`, name: metadata.name, license: metadata.license }];
});

describe("open-source scope package table", () => {
  it("lists exactly the published packages, with their actual paths and licenses", () => {
    const ordered = (items) => [...items].sort((a, b) => a.name.localeCompare(b.name));
    expect(ordered(rows)).toEqual(ordered(published));
  });
});
