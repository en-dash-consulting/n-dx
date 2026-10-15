import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguage, detectLanguages, getLanguageConfig } from "../../../src/language/detect.js";
import { csharpConfig } from "../../../src/language/csharp.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

async function project(files: Record<string, string>): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "sv-cs-detect-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(tmpDir, path)), { recursive: true });
    await writeFile(join(tmpDir, path), text);
  }
  return tmpDir;
}

describe("C# language detection", () => {
  it("detects C# from a root .sln", async () => {
    const dir = await project({ "App.sln": "", "App/Program.cs": "" });
    expect(await detectLanguage(dir)).toBe(csharpConfig);
  });

  it("detects C# from a .csproj one level down", async () => {
    const dir = await project({ "WebApp/WebApp.csproj": "", "WebApp/Default.aspx.cs": "" });
    expect(await detectLanguage(dir)).toBe(csharpConfig);
  });

  it("picks C# over a package.json when C# is most of the authored code, counting below the top level", async () => {
    const dir = await project({
      "package.json": "{}",
      "Site.sln": "",
      "gulpfile.js": "",
      "Scripts/site.js": "",
      "Scripts/jquery-3.7.1.min.js": "",
      "Scripts/bootstrap.min.js": "",
      "Scripts/vendor.min.js": "",
      "src/Site/Site.csproj": "",
      "src/Site/Pages/Default.aspx": "",
      "src/Site/Pages/Default.aspx.cs": "",
      "src/Site/Pages/Orders.aspx.cs": "",
      "src/Site/Services/OrderService.cs": "",
    });
    expect(await detectLanguage(dir)).toBe(csharpConfig);
    expect((await detectLanguages(dir)).map((c) => c.id)).toEqual(["csharp", "typescript"]);
  });

  it("keeps TypeScript primary when JS/TS dominates a repo that also has a .csproj", async () => {
    const dir = await project({
      "package.json": "{}",
      "tools/Gen/Gen.csproj": "",
      "tools/Gen/Program.cs": "",
      "src/a.ts": "",
      "src/b.ts": "",
      "src/c.ts": "",
    });
    expect((await detectLanguage(dir)).id).toBe("typescript");
  });

  it("accepts csharp as the config override", async () => {
    const dir = await project({ ".n-dx.json": JSON.stringify({ language: "csharp" }), "package.json": "{}" });
    expect(await detectLanguage(dir)).toBe(csharpConfig);
    expect(getLanguageConfig("csharp")).toBe(csharpConfig);
  });
});
