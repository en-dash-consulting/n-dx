import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCSharpImportGraph,
  extractCSharpFacts,
  extractWebFormsReferences,
  stripCSharpCommentsAndStrings,
} from "../../../src/analyzers/csharp-imports.js";
import { analyzeImports } from "../../../src/analyzers/imports.js";
import { analyzeInventory } from "../../../src/analyzers/inventory.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

async function project(files: Record<string, string>): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "sv-cs-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(tmpDir, path)), { recursive: true });
    await writeFile(join(tmpDir, path), text);
  }
  return tmpDir;
}

async function graph(files: Record<string, string>) {
  const dir = await project(files);
  return buildCSharpImportGraph(Object.keys(files).map((path) => ({ path })), dir);
}

const pairs = (edges: Array<{ from: string; to: string }>) =>
  edges.map((e) => `${e.from} -> ${e.to}`).sort();

describe("stripCSharpCommentsAndStrings", () => {
  it("removes comments and every string form, keeping newlines", () => {
    const src = [
      `var a = "Order"; // Order`,
      `/* Order */ var b = @"C:\\Order""s";`,
      `var c = $"{x} Order";`,
      `var d = """`,
      `Order`,
      `""";`,
      `var e = '"'; var f = '\\'';`,
    ].join("\n");
    const out = stripCSharpCommentsAndStrings(src);
    expect(out).not.toContain("Order");
    expect(out.split("\n")).toHaveLength(7);
    expect(out).toContain("var f =");
  });
});

describe("extractCSharpFacts", () => {
  it("indexes block and file-scoped namespaces, nested namespaces and type kinds", () => {
    const block = extractCSharpFacts(`
namespace App {
  namespace Models {
    public partial class User<T> where T : class { }
    public record struct Point(int X, int Y);
    internal enum Role { Admin }
  }
  public interface IRepo { }
  public delegate void Handler(object sender);
}
`);
    expect(block.namespaces.sort()).toEqual(["App", "App.Models"]);
    expect(block.types.sort()).toEqual([
      "App.Handler",
      "App.IRepo",
      "App.Models.Point",
      "App.Models.Role",
      "App.Models.User",
    ]);

    const fileScoped = extractCSharpFacts(`namespace App.Services;\npublic sealed class Mailer { }\n`);
    expect(fileScoped.namespaces).toEqual(["App.Services"]);
    expect(fileScoped.types).toEqual(["App.Services.Mailer"]);
  });

  it("reads every using form and skips using statements", () => {
    const facts = extractCSharpFacts(`
global using App.Shared;
using System.Linq;
using static App.Util.Guard;
using Repo = App.Data.Repository;
class X {
  void M() {
    using (var s = Open()) { }
    using var t = Open();
  }
}
`);
    expect(facts.globalUsings).toEqual(["App.Shared"]);
    expect(facts.usings).toEqual(["System.Linq"]);
    expect(facts.staticUsings).toEqual(["App.Util.Guard"]);
    expect(Object.fromEntries(facts.aliases)).toEqual({ Repo: "App.Data.Repository" });
  });
});

describe("buildCSharpImportGraph", () => {
  it("links a reference to a type in the same namespace", async () => {
    const result = await graph({
      "Models/User.cs": `namespace App.Models { public class User { } }`,
      "Models/Team.cs": `namespace App.Models { public class Team { public List<User> Members; } }`,
    });
    expect(pairs(result.edges)).toEqual(["Models/Team.cs -> Models/User.cs"]);
    expect(result.edges[0].symbols).toEqual(["User"]);
  });

  it("resolves through parent namespaces, usings, global usings and aliases", async () => {
    const result = await graph({
      "Core/Entity.cs": `namespace App { public abstract class Entity { } }`,
      "Models/User.cs": `namespace App.Models;\npublic class User : Entity { }`,
      "Data/Repository.cs": `namespace App.Data;\npublic class Repository { }`,
      "Util/Guard.cs": `namespace App.Util;\npublic static class Guard { }`,
      "Usings.cs": `global using App.Models;`,
      "Web/Controller.cs": `using App.Data;\nnamespace App.Web;\nclass Controller { Repository r; User u; }`,
      "Web/Other.cs": `using R = App.Data.Repository;\nusing static App.Util.Guard;\nnamespace App.Web;\nclass Other { R r; }`,
    });
    expect(pairs(result.edges)).toEqual([
      "Models/User.cs -> Core/Entity.cs",
      "Web/Controller.cs -> Data/Repository.cs",
      "Web/Controller.cs -> Models/User.cs",
      "Web/Other.cs -> Data/Repository.cs",
      "Web/Other.cs -> Util/Guard.cs",
    ]);
  });

  it("resolves namespace-qualified and member-access names", async () => {
    const result = await graph({
      "A.cs": `namespace Lib.Text { public static class Slug { public static string Make(string s) => s; } }`,
      "B.cs": `namespace App { class B { string x = Lib.Text.Slug.Make("a"); } }`,
      "C.cs": `using Lib.Text;\nnamespace App { class C { string x = Slug.Make("a"); } }`,
    });
    expect(pairs(result.edges)).toEqual(["B.cs -> A.cs", "C.cs -> A.cs"]);
  });

  it("does not resolve a type whose namespace is not visible", async () => {
    const result = await graph({
      "A.cs": `namespace Lib.Hidden { public class Widget { } }`,
      "B.cs": `namespace App { class B { Widget w; } }`,
    });
    expect(result.edges).toEqual([]);
  });

  it("links a partial type reference to every part, and parts to each other", async () => {
    const result = await graph({
      "Order.cs": `namespace App { public partial class Order { } }`,
      "Order.Logic.cs": `namespace App { public partial class Order { void Ship() { } } }`,
      "Shop.cs": `namespace App { class Shop { Order o; } }`,
    });
    expect(pairs(result.edges)).toEqual([
      "Order.Logic.cs -> Order.cs",
      "Order.cs -> Order.Logic.cs",
      "Shop.cs -> Order.Logic.cs",
      "Shop.cs -> Order.cs",
    ]);
  });

  it("resolves attribute usages to their Attribute class", async () => {
    const result = await graph({
      "AuditedAttribute.cs": `namespace App { public class AuditedAttribute : System.Attribute { } }`,
      "Svc.cs": `namespace App { [Audited] class Svc { } }`,
    });
    expect(pairs(result.edges)).toEqual(["Svc.cs -> AuditedAttribute.cs"]);
  });

  it("ignores names in comments and strings, and unknown types", async () => {
    const result = await graph({
      "A.cs": `namespace App { public class Order { } }`,
      "B.cs": `using System;\nnamespace App { class B { // Order\n string s = "Order"; DateTime d; Console c; } }`,
    });
    expect(result.edges).toEqual([]);
    expect(result.external).toEqual([{ package: "stdlib:System", importedBy: ["B.cs"], symbols: ["*"] }]);
  });

  it("reports usings of namespaces the project does not declare as external", async () => {
    const result = await graph({
      "A.cs": `using Newtonsoft.Json;\nusing App.Models;\nnamespace App.Models { class A { } }`,
    });
    expect(result.external.map((e) => e.package)).toEqual(["Newtonsoft.Json"]);
  });

  it("emits edges only for the requested files while indexing all of them", async () => {
    const dir = await project({
      "A.cs": `namespace App { public class Alpha { Beta b; } }`,
      "B.cs": `namespace App { public class Beta { Alpha a; } }`,
    });
    const result = await buildCSharpImportGraph([{ path: "A.cs" }, { path: "B.cs" }], dir, new Set(["B.cs"]));
    expect(pairs(result.edges)).toEqual(["B.cs -> A.cs"]);
  });
});

describe("analyzeImports on a C# project", () => {
  it("produces a non-empty import graph", async () => {
    const dir = await project({
      "App.sln": "",
      "src/App/App.csproj": `<Project Sdk="Microsoft.NET.Sdk"></Project>`,
      "src/App/Models/User.cs": `namespace App.Models;\npublic class User { }`,
      "src/App/Services/UserService.cs": `using App.Models;\nnamespace App.Services;\npublic class UserService { public User Find() => new User(); }`,
      "src/App/Program.cs": `using App.Services;\nvar svc = new UserService();`,
    });
    const inventory = await analyzeInventory(dir);
    const imports = await analyzeImports(dir, inventory);
    expect(pairs(imports.edges)).toEqual([
      "src/App/Program.cs -> src/App/Services/UserService.cs",
      "src/App/Services/UserService.cs -> src/App/Models/User.cs",
    ]);
  });
});

describe("WebForms markup", () => {
  it("reads code-behind, class, master page and registered controls from directives", () => {
    const refs = extractWebFormsReferences(`
<%@ Page Language="C#" MasterPageFile="~/Site.Master" AutoEventWireup="true"
    CodeBehind="Default.aspx.cs" Inherits="Shop.Web._Default" %>
<%@ Register TagPrefix="uc" TagName="Cart" Src="~/Controls/Cart.ascx" %>
<%@ Register Assembly="Telerik.Web.UI" Namespace="Telerik.Web.UI" TagPrefix="t" %>
<%@ Import Namespace="System.Linq" %>
`);
    expect(refs.paths).toEqual(["~/Site.Master", "Default.aspx.cs", "~/Controls/Cart.ascx"]);
    expect(refs.classes).toEqual(["Shop.Web._Default"]);
  });

  it("links pages, controls, masters and handlers to their code", async () => {
    const result = await graph({
      "Web/Site.Master": `<%@ Master Language="C#" CodeFile="Site.Master.cs" Inherits="Shop.Web.SiteMaster" %>`,
      "Web/Site.Master.cs": `namespace Shop.Web { public partial class SiteMaster { } }`,
      "Web/Pages/Default.aspx": `<%@ Page MasterPageFile="~/Site.Master" CodeBehind="Default.aspx.cs" Inherits="Shop.Web._Default" %>\n<%@ Register TagPrefix="uc" Src="../Controls/Cart.ascx" TagName="Cart" %>`,
      "Web/Pages/Default.aspx.cs": `namespace Shop.Web { public partial class _Default { } }`,
      "Web/Controls/Cart.ascx": `<%@ Control CodeBehind="Cart.ascx.cs" Inherits="Shop.Web.Controls.Cart" %>`,
      "Web/Controls/Cart.ascx.cs": `namespace Shop.Web.Controls { public partial class Cart { } }`,
      "Web/Api/Ping.ashx": `<%@ WebHandler Language="C#" Class="Shop.Web.Api.Ping" %>`,
      "Web/Api/Ping.cs": `namespace Shop.Web.Api { public class Ping { } }`,
    });
    expect(pairs(result.edges)).toEqual([
      "Web/Api/Ping.ashx -> Web/Api/Ping.cs",
      "Web/Controls/Cart.ascx -> Web/Controls/Cart.ascx.cs",
      "Web/Pages/Default.aspx -> Web/Controls/Cart.ascx",
      "Web/Pages/Default.aspx -> Web/Pages/Default.aspx.cs",
      "Web/Pages/Default.aspx -> Web/Site.Master",
      "Web/Site.Master -> Web/Site.Master.cs",
    ]);
  });

  it("are inventoried and take part in the import graph", async () => {
    const dir = await project({
      "Shop.sln": "",
      "Web/Default.aspx": `<%@ Page CodeBehind="Default.aspx.cs" Inherits="Shop._Default" %>`,
      "Web/Default.aspx.cs": `namespace Shop { public partial class _Default { } }`,
    });
    const inventory = await analyzeInventory(dir);
    expect(inventory.files.map((f) => f.path)).toContain("Web/Default.aspx");
    const imports = await analyzeImports(dir, inventory);
    expect(pairs(imports.edges)).toEqual(["Web/Default.aspx -> Web/Default.aspx.cs"]);
  });
});

describe("WebForms code-behind scoping", () => {
  const page = (name: string, cls = "_Default") => ({
    [`Web/${name}.aspx`]: `<%@ Page CodeFile="${name}.aspx.cs" Inherits="${cls}" %>`,
    [`Web/${name}.aspx.cs`]: `public partial class ${cls} : SecurePage { void Page_Load() { new Helper(); } }`,
  });

  it("does not link copy-pasted pages that declare the same class", async () => {
    const result = await graph({
      ...page("Orders"),
      ...page("Invoices"),
      "Web/Orders.aspx.designer.cs": `public partial class _Default { protected Label Title; }`,
      "App_Code/SecurePage.cs": `public class SecurePage { }`,
      "App_Code/Helper.cs": `public class Helper { }`,
    });
    expect(pairs(result.edges)).toEqual([
      "Web/Invoices.aspx -> Web/Invoices.aspx.cs",
      "Web/Invoices.aspx.cs -> App_Code/Helper.cs",
      "Web/Invoices.aspx.cs -> App_Code/SecurePage.cs",
      "Web/Orders.aspx -> Web/Orders.aspx.cs",
      "Web/Orders.aspx -> Web/Orders.aspx.designer.cs",
      "Web/Orders.aspx.cs -> App_Code/Helper.cs",
      "Web/Orders.aspx.cs -> App_Code/SecurePage.cs",
      "Web/Orders.aspx.cs -> Web/Orders.aspx.designer.cs",
      "Web/Orders.aspx.designer.cs -> Web/Orders.aspx.cs",
    ]);
  });

  it("reports no cycle between pages sharing a class name", async () => {
    const dir = await project({
      "Site.sln": "",
      ...page("A"),
      ...page("B"),
      ...page("C"),
      "App_Code/SecurePage.cs": `public class SecurePage { }`,
      "App_Code/Helper.cs": `public class Helper { }`,
    });
    const imports = await analyzeImports(dir, await analyzeInventory(dir));
    expect(imports.edges.some((e) => e.from.endsWith(".aspx.cs") && e.to.endsWith(".aspx.cs"))).toBe(false);
    expect(imports.summary.circularCount).toBe(0);
  });

  it("resolves an outside reference to a page class only when one page declares it", async () => {
    const result = await graph({
      ...page("Orders"),
      ...page("Invoices"),
      ...page("Login", "LoginPage"),
      "App_Code/Nav.cs": `public class Nav { _Default d; LoginPage l; }`,
    });
    expect(pairs(result.edges).filter((p) => p.startsWith("App_Code/"))).toEqual([
      "App_Code/Nav.cs -> Web/Login.aspx.cs",
    ]);
  });

  it("still links every part of a partial class outside code-behind files", async () => {
    const result = await graph({
      "App_Code/Order.cs": `public partial class Order { }`,
      "App_Code/Order.Pricing.cs": `public partial class Order { }`,
    });
    expect(pairs(result.edges)).toEqual([
      "App_Code/Order.Pricing.cs -> App_Code/Order.cs",
      "App_Code/Order.cs -> App_Code/Order.Pricing.cs",
    ]);
  });
});
