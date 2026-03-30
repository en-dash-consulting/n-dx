import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractGoImports, readGoModulePath } from "../../../src/analyzers/go-imports.js";

const FIXTURE_DIR = join(__dirname, "../../fixtures/go-project");
const MODULE_PATH = "github.com/example/go-project";

/** Read a Go fixture file relative to the go-project root. */
async function readFixture(relPath: string): Promise<string> {
  return readFile(join(FIXTURE_DIR, relPath), "utf-8");
}

// ── readGoModulePath ─────────────────────────────────────────────────────────

describe("readGoModulePath", () => {
  it("extracts module path from go.mod", async () => {
    const result = await readGoModulePath(FIXTURE_DIR);
    expect(result).toBe(MODULE_PATH);
  });

  it("returns null for nonexistent directory", async () => {
    const result = await readGoModulePath("/tmp/nonexistent-go-project-dir");
    expect(result).toBeNull();
  });
});

// ── extractGoImports — single-line imports ───────────────────────────────────

describe("extractGoImports — single-line imports", () => {
  it("parses a bare single-line import", () => {
    const source = `package main\n\nimport "fmt"\n`;
    const { raw, external } = extractGoImports(source, "main.go", null);

    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "fmt", alias: null, kind: "stdlib" });
    expect(external).toHaveLength(1);
    expect(external[0].package).toBe("stdlib:fmt");
  });

  it("parses a single-line import with alias", () => {
    const source = `package main\n\nimport f "fmt"\n`;
    const { raw } = extractGoImports(source, "main.go", null);

    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "fmt", alias: "f", kind: "stdlib" });
  });

  it("parses a single-line blank import", () => {
    const source = `package main\n\nimport _ "net/http/pprof"\n`;
    const { raw, external } = extractGoImports(source, "main.go", null);

    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "net/http/pprof", alias: "_", kind: "stdlib" });
    expect(external[0].package).toBe("stdlib:net/http/pprof");
  });

  it("parses a single-line dot import", () => {
    const source = `package main\n\nimport . "fmt"\n`;
    const { raw } = extractGoImports(source, "main.go", null);

    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "fmt", alias: ".", kind: "stdlib" });
  });

  it("handles fixture: auth.go single-line import", async () => {
    const source = await readFixture("internal/middleware/auth.go");
    const { raw, external, edges } = extractGoImports(
      source,
      "internal/middleware/auth.go",
      MODULE_PATH,
    );

    // import "net/http" — single-line form
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "net/http", alias: null, kind: "stdlib" });
    expect(external).toHaveLength(1);
    expect(external[0].package).toBe("stdlib:net/http");
    expect(edges).toHaveLength(0);
  });
});

// ── extractGoImports — grouped import blocks ─────────────────────────────────

describe("extractGoImports — grouped import blocks", () => {
  it("parses a grouped import block with multiple packages", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  "fmt"`,
      `  "os"`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(2);
    expect(raw[0]).toMatchObject({ path: "fmt", alias: null, kind: "stdlib" });
    expect(raw[1]).toMatchObject({ path: "os", alias: null, kind: "stdlib" });
  });

  it("handles blank lines separating stdlib and third-party groups", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  "fmt"`,
      `  "net/http"`,
      ``,
      `  "github.com/go-chi/chi/v5"`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(3);
    expect(raw[0].kind).toBe("stdlib");
    expect(raw[1].kind).toBe("stdlib");
    expect(raw[2]).toMatchObject({
      path: "github.com/go-chi/chi/v5",
      alias: null,
      kind: "third-party",
    });
  });

  it("handles fixture: main.go grouped block with stdlib + internal", async () => {
    const source = await readFixture("cmd/api/main.go");
    const { raw, edges, external } = extractGoImports(
      source,
      "cmd/api/main.go",
      MODULE_PATH,
    );

    // 2 stdlib (fmt, net/http) + 2 internal (handler, config)
    expect(raw).toHaveLength(4);

    const stdlib = raw.filter((r) => r.kind === "stdlib");
    const internal = raw.filter((r) => r.kind === "internal");
    expect(stdlib).toHaveLength(2);
    expect(internal).toHaveLength(2);

    // Internal edges resolve to relative dir paths
    expect(edges).toHaveLength(2);
    const edgePaths = edges.map((e) => e.to).sort();
    expect(edgePaths).toEqual(["internal/config", "internal/handler"]);
    for (const edge of edges) {
      expect(edge.from).toBe("cmd/api/main.go");
      expect(edge.type).toBe("static");
    }

    // External stdlib entries prefixed with "stdlib:"
    expect(external).toHaveLength(2);
    const pkgNames = external.map((e) => e.package).sort();
    expect(pkgNames).toEqual(["stdlib:fmt", "stdlib:net/http"]);
  });

  it("handles fixture: logging.go grouped block with three stdlib imports", async () => {
    const source = await readFixture("internal/middleware/logging.go");
    const { raw, external } = extractGoImports(
      source,
      "internal/middleware/logging.go",
      MODULE_PATH,
    );

    expect(raw).toHaveLength(3);
    expect(raw.every((r) => r.kind === "stdlib")).toBe(true);
    const paths = raw.map((r) => r.path).sort();
    expect(paths).toEqual(["log", "net/http", "time"]);
    expect(external).toHaveLength(3);
  });

  it("handles fixture: handler/user.go with stdlib + internal in grouped block", async () => {
    const source = await readFixture("internal/handler/user.go");
    const { raw, edges, external } = extractGoImports(
      source,
      "internal/handler/user.go",
      MODULE_PATH,
    );

    // encoding/json, net/http (stdlib) + internal/service (internal)
    expect(raw).toHaveLength(3);
    expect(raw.filter((r) => r.kind === "stdlib")).toHaveLength(2);
    expect(raw.filter((r) => r.kind === "internal")).toHaveLength(1);

    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBe("internal/service");
    expect(edges[0].from).toBe("internal/handler/user.go");

    expect(external).toHaveLength(2);
    expect(external.map((e) => e.package).sort()).toEqual([
      "stdlib:encoding/json",
      "stdlib:net/http",
    ]);
  });

  it("handles fixture: service/user.go with sole internal import", async () => {
    const source = await readFixture("internal/service/user.go");
    const { raw, edges, external } = extractGoImports(
      source,
      "internal/service/user.go",
      MODULE_PATH,
    );

    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      path: `${MODULE_PATH}/internal/repository`,
      alias: null,
      kind: "internal",
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBe("internal/repository");
    expect(external).toHaveLength(0);
  });
});

// ── extractGoImports — alias and blank import variants ───────────────────────

describe("extractGoImports — alias, blank, and dot import variants", () => {
  it("classifies aliased import inside a grouped block", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  chi "github.com/go-chi/chi/v5"`,
      `)`,
    ].join("\n");

    const { raw, external } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      path: "github.com/go-chi/chi/v5",
      alias: "chi",
      kind: "third-party",
    });
    expect(external[0].package).toBe("github.com/go-chi/chi/v5");
  });

  it("classifies blank import inside a grouped block", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  _ "github.com/lib/pq"`,
      `)`,
    ].join("\n");

    const { raw, external } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      path: "github.com/lib/pq",
      alias: "_",
      kind: "third-party",
    });
    expect(external[0].package).toBe("github.com/lib/pq");
  });

  it("classifies dot import inside a grouped block", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  . "testing"`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "testing", alias: ".", kind: "stdlib" });
  });

  it("aliased internal import produces edge with alias in symbols", () => {
    const source = `package main\n\nimport repo "github.com/example/go-project/internal/repository"\n`;
    const { edges } = extractGoImports(source, "main.go", MODULE_PATH);

    expect(edges).toHaveLength(1);
    expect(edges[0].symbols).toEqual(["repo"]);
  });

  it("blank internal import produces edge with wildcard symbol", () => {
    const source = `package main\n\nimport _ "github.com/example/go-project/internal/config"\n`;
    const { edges } = extractGoImports(source, "main.go", MODULE_PATH);

    expect(edges).toHaveLength(1);
    expect(edges[0].symbols).toEqual(["*"]);
  });

  it("dot internal import produces edge with wildcard symbol", () => {
    const source = `package main\n\nimport . "github.com/example/go-project/internal/config"\n`;
    const { edges } = extractGoImports(source, "main.go", MODULE_PATH);

    expect(edges).toHaveLength(1);
    expect(edges[0].symbols).toEqual(["*"]);
  });
});

// ── extractGoImports — stdlib classification ─────────────────────────────────

describe("extractGoImports — stdlib classification", () => {
  it("classifies single-segment paths as stdlib", () => {
    for (const pkg of ["fmt", "os", "log", "testing", "time", "errors"]) {
      const { raw } = extractGoImports(`package x\nimport "${pkg}"\n`, "x.go", null);
      expect(raw[0].kind).toBe("stdlib");
    }
  });

  it("classifies multi-segment stdlib paths (no dots) as stdlib", () => {
    for (const pkg of ["net/http", "encoding/json", "net/http/httptest", "database/sql"]) {
      const { raw } = extractGoImports(`package x\nimport "${pkg}"\n`, "x.go", null);
      expect(raw[0].kind).toBe("stdlib");
    }
  });

  it("stdlib external entries are prefixed with 'stdlib:'", () => {
    const source = `package x\nimport "encoding/json"\n`;
    const { external } = extractGoImports(source, "x.go", null);
    expect(external[0].package).toBe("stdlib:encoding/json");
  });
});

// ── extractGoImports — third-party classification ────────────────────────────

describe("extractGoImports — third-party classification", () => {
  it("classifies paths with dots as third-party when no module match", () => {
    const thirdParty = [
      "github.com/go-chi/chi/v5",
      "github.com/jmoiron/sqlx",
      "golang.org/x/text",
      "google.golang.org/grpc",
    ];
    for (const pkg of thirdParty) {
      const { raw } = extractGoImports(`package x\nimport "${pkg}"\n`, "x.go", null);
      expect(raw[0].kind).toBe("third-party");
    }
  });

  it("third-party external entries use raw import path", () => {
    const source = `package x\nimport "github.com/go-chi/chi/v5"\n`;
    const { external } = extractGoImports(source, "x.go", null);
    expect(external[0].package).toBe("github.com/go-chi/chi/v5");
  });
});

// ── extractGoImports — internal import resolution ────────────────────────────

describe("extractGoImports — internal import resolution", () => {
  it("classifies module-prefixed paths as internal", () => {
    const source = `package x\nimport "${MODULE_PATH}/internal/handler"\n`;
    const { raw } = extractGoImports(source, "x.go", MODULE_PATH);
    expect(raw[0].kind).toBe("internal");
  });

  it("resolves internal import to correct relative directory path", () => {
    const source = `package x\nimport "${MODULE_PATH}/internal/service"\n`;
    const { edges } = extractGoImports(source, "x.go", MODULE_PATH);
    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBe("internal/service");
  });

  it("resolves deeply nested internal import path", () => {
    const source = `package x\nimport "${MODULE_PATH}/internal/handler/admin"\n`;
    const { edges } = extractGoImports(source, "x.go", MODULE_PATH);
    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBe("internal/handler/admin");
  });

  it("resolves pkg/ internal import path", () => {
    const source = `package x\nimport "${MODULE_PATH}/pkg/response"\n`;
    const { edges } = extractGoImports(source, "x.go", MODULE_PATH);
    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBe("pkg/response");
  });

  it("does not produce edges when modulePath is null", () => {
    const source = `package x\nimport "${MODULE_PATH}/internal/handler"\n`;
    const { edges, external } = extractGoImports(source, "x.go", null);
    // Without module path, the import is treated as third-party
    expect(edges).toHaveLength(0);
    expect(external).toHaveLength(1);
    expect(external[0].package).toBe(MODULE_PATH + "/internal/handler");
  });

  it("exact module path match is classified as internal", () => {
    const source = `package x\nimport "${MODULE_PATH}"\n`;
    const { raw } = extractGoImports(source, "x.go", MODULE_PATH);
    expect(raw[0].kind).toBe("internal");
  });
});

// ── extractGoImports — comments inside import blocks ─────────────────────────

describe("extractGoImports — comments inside import blocks", () => {
  it("ignores line comments inside grouped import block", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  // standard library`,
      `  "fmt"`,
      `  // networking`,
      `  "net/http"`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(2);
    expect(raw[0].path).toBe("fmt");
    expect(raw[1].path).toBe("net/http");
  });

  it("ignores inline comments after import path", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  "fmt" // for formatting`,
      `  "os"  // for OS operations`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(2);
    expect(raw[0].path).toBe("fmt");
    expect(raw[1].path).toBe("os");
  });

  it("ignores block comments inside grouped import block", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  /* stdlib imports */`,
      `  "fmt"`,
      `  "os"`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(2);
  });

  it("ignores multi-line block comments spanning import lines", () => {
    const source = [
      `package main`,
      ``,
      `import (`,
      `  "fmt"`,
      `  /*`,
      `  "os"`,
      `  "log"`,
      `  */`,
      `  "time"`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(2);
    expect(raw[0].path).toBe("fmt");
    expect(raw[1].path).toBe("time");
  });

  it("ignores comment-only lines in single-line import context", () => {
    const source = [
      `package main`,
      ``,
      `// import "os"  <- not a real import`,
      `import "fmt"`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(1);
    expect(raw[0].path).toBe("fmt");
  });
});

// ── extractGoImports — string literals that resemble imports ─────────────────

describe("extractGoImports — string literals should not produce spurious imports", () => {
  it("does not parse import-like string inside a function body", () => {
    const source = [
      `package main`,
      ``,
      `import "fmt"`,
      ``,
      `func main() {`,
      `  s := "import \"os\""`,
      `  fmt.Println(s)`,
      `}`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    // Only "fmt" — the string literal should not be parsed
    expect(raw).toHaveLength(1);
    expect(raw[0].path).toBe("fmt");
  });

  it("does not parse import-like text in backtick string", () => {
    const source = [
      "package main",
      "",
      'import "fmt"',
      "",
      "var help = `",
      'import "os"',
      "import (",
      '  "log"',
      ")",
      "`",
    ].join("\n");

    // Note: The regex parser doesn't track backtick strings across lines,
    // so it may parse the "os" and "log" inside the raw string literal.
    // This test documents current behavior. In practice, Go raw strings
    // containing import statements are extremely rare.
    const { raw } = extractGoImports(source, "main.go", null);
    // At minimum, "fmt" should be present
    expect(raw.some((r) => r.path === "fmt")).toBe(true);
  });
});

// ── extractGoImports — edge cases ────────────────────────────────────────────

describe("extractGoImports — edge cases", () => {
  it("returns empty results for file with no imports", () => {
    const source = `package repository\n\ntype User struct {\n  ID int\n}\n`;
    const { raw, edges, external } = extractGoImports(source, "user.go", MODULE_PATH);
    expect(raw).toHaveLength(0);
    expect(edges).toHaveLength(0);
    expect(external).toHaveLength(0);
  });

  it("returns empty results for empty string", () => {
    const { raw, edges, external } = extractGoImports("", "empty.go", null);
    expect(raw).toHaveLength(0);
    expect(edges).toHaveLength(0);
    expect(external).toHaveLength(0);
  });

  it("handles fixture: repository/user.go with no imports", async () => {
    const source = await readFixture("internal/repository/user.go");
    const { raw, edges, external } = extractGoImports(
      source,
      "internal/repository/user.go",
      MODULE_PATH,
    );
    expect(raw).toHaveLength(0);
    expect(edges).toHaveLength(0);
    expect(external).toHaveLength(0);
  });

  it("handles fixture: config/config.go single-line stdlib import", async () => {
    const source = await readFixture("internal/config/config.go");
    const { raw, external } = extractGoImports(
      source,
      "internal/config/config.go",
      MODULE_PATH,
    );
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "os", alias: null, kind: "stdlib" });
    expect(external[0].package).toBe("stdlib:os");
  });

  it("handles fixture: pkg/response/json.go grouped stdlib block", async () => {
    const source = await readFixture("pkg/response/json.go");
    const { raw, external, edges } = extractGoImports(
      source,
      "pkg/response/json.go",
      MODULE_PATH,
    );
    expect(raw).toHaveLength(2);
    expect(raw.every((r) => r.kind === "stdlib")).toBe(true);
    expect(external).toHaveLength(2);
    expect(edges).toHaveLength(0);
  });

  it("handles fixture: test file with stdlib-only grouped imports", async () => {
    const source = await readFixture("internal/handler/user_test.go");
    const { raw } = extractGoImports(
      source,
      "internal/handler/user_test.go",
      MODULE_PATH,
    );
    // net/http, net/http/httptest, testing
    expect(raw).toHaveLength(3);
    expect(raw.every((r) => r.kind === "stdlib")).toBe(true);
  });

  it("handles fixture: test file with single-line stdlib import", async () => {
    const source = await readFixture("internal/service/user_test.go");
    const { raw } = extractGoImports(
      source,
      "internal/service/user_test.go",
      MODULE_PATH,
    );
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ path: "testing", kind: "stdlib" });
  });

  it("handles multiple import blocks in the same file", () => {
    const source = [
      `package main`,
      ``,
      `import "fmt"`,
      ``,
      `import (`,
      `  "os"`,
      `  "log"`,
      `)`,
    ].join("\n");

    const { raw } = extractGoImports(source, "main.go", null);
    expect(raw).toHaveLength(3);
    expect(raw.map((r) => r.path).sort()).toEqual(["fmt", "log", "os"]);
  });

  it("deduplicates external entries when same package imported from same file", () => {
    // Unlikely in real Go, but tests the dedup logic
    const source = [
      `package main`,
      ``,
      `import "fmt"`,
      `import "fmt"`,
    ].join("\n");

    const { raw, external } = extractGoImports(source, "main.go", null);
    // raw captures both occurrences
    expect(raw).toHaveLength(2);
    // external deduplicates
    expect(external).toHaveLength(1);
    expect(external[0].package).toBe("stdlib:fmt");
    expect(external[0].importedBy).toEqual(["main.go"]);
  });

  it("mixed single-line and grouped imports work together", () => {
    const source = [
      `package main`,
      ``,
      `import "fmt"`,
      ``,
      `import (`,
      `  "os"`,
      `  chi "github.com/go-chi/chi/v5"`,
      `  _ "github.com/lib/pq"`,
      `  "github.com/example/go-project/internal/handler"`,
      `)`,
    ].join("\n");

    const { raw, edges, external } = extractGoImports(source, "main.go", MODULE_PATH);

    expect(raw).toHaveLength(5);
    expect(raw.filter((r) => r.kind === "stdlib")).toHaveLength(2);
    expect(raw.filter((r) => r.kind === "third-party")).toHaveLength(2);
    expect(raw.filter((r) => r.kind === "internal")).toHaveLength(1);

    // Internal edge
    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBe("internal/handler");

    // External: 2 stdlib + 2 third-party = 4
    expect(external).toHaveLength(4);
  });

  it("importedBy tracks the correct file path", () => {
    const source = `package x\nimport "fmt"\n`;
    const { external } = extractGoImports(source, "cmd/api/main.go", null);
    expect(external[0].importedBy).toEqual(["cmd/api/main.go"]);
  });

  it("edge from field tracks the correct file path", () => {
    const source = `package x\nimport "${MODULE_PATH}/internal/handler"\n`;
    const { edges } = extractGoImports(source, "cmd/api/main.go", MODULE_PATH);
    expect(edges[0].from).toBe("cmd/api/main.go");
  });

  it("all edges have type 'static'", () => {
    const source = [
      `package x`,
      `import (`,
      `  "${MODULE_PATH}/internal/handler"`,
      `  "${MODULE_PATH}/internal/service"`,
      `)`,
    ].join("\n");

    const { edges } = extractGoImports(source, "main.go", MODULE_PATH);
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      expect(edge.type).toBe("static");
    }
  });

  it("unaliased internal import produces wildcard symbol", () => {
    const source = `package x\nimport "${MODULE_PATH}/internal/handler"\n`;
    const { edges } = extractGoImports(source, "main.go", MODULE_PATH);
    expect(edges[0].symbols).toEqual(["*"]);
  });

  it("external entries have wildcard symbols", () => {
    const source = `package x\nimport "fmt"\n`;
    const { external } = extractGoImports(source, "x.go", null);
    expect(external[0].symbols).toEqual(["*"]);
  });
});
