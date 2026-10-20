/**
 * Table names from SQL embedded in Go sources, run through the real Go pack
 * (skipped when the grammar is not built).
 */

import { afterAll, describe, expect, it } from "vitest";

import type { EmbeddedSqlTable } from "@n-dx/lang-kit";
import { createTreeSitterRunner, skipUnlessGrammar, type ParsedFile } from "@n-dx/lang-runtime";
import { goGrammarPath, goPack } from "../../src/go-pack.js";
import { extractGoEmbeddedSql } from "../../src/go-sql.js";

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

async function parseAll(ctx: Parameters<typeof skipUnlessGrammar>[0], sources: Record<string, string>): Promise<ParsedFile[]> {
  const wasm = goGrammarPath();
  skipUnlessGrammar(ctx, wasm);
  const target = { pack: goPack, grammarPath: wasm };
  const files: ParsedFile[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const result = await runner.parseSource(target, path, source);
    if (result.status !== "parsed") throw new Error("expected a parsed file");
    expect(result.hasErrorNodes || result.hasMissingNodes, path).toBe(false);
    files.push(result);
  }
  return files;
}

const summary = (tables: readonly EmbeddedSqlTable[]): string[] =>
  tables.map((t) => `${t.schema ? `${t.schema}.` : ""}${t.name} ${t.via} ${t.path}:${t.line}`);

const GO_SOURCE = `package store

func run(db *sql.DB, x *sqlx.DB, ctx context.Context) {
	db.Query("SELECT id FROM owners WHERE id = ?", 1)
	db.QueryRowContext(ctx, \`SELECT name
FROM pets p JOIN types t ON t.id = p.type_id\`)
	db.Exec("INSERT INTO visits (pet_id) VALUES (?)", 1)
	x.Get(&owner, "select * from clinic.owners where id = $1", 1)
	x.Select(&pets, "SELECT * FROM pets")
	x.NamedExec("UPDATE vets SET name = :name", v)
	http.Get("https://example.com/select/from/x")
	log.Println(db.Query("SELECT 1 FROM wrapped"))
	other.Frobnicate("SELECT * FROM not_a_sql_method")
	db.Query(fmt.Sprintf("SELECT * FROM %s", name))
}
`;

describe("Go embedded SQL", () => {
  it("reads database/sql and sqlx calls and nothing else", async (ctx) => {
    const files = await parseAll(ctx, { "store/store.go": GO_SOURCE });
    expect(summary(extractGoEmbeddedSql(files))).toEqual([
      "owners Query store/store.go:4",
      "pets QueryRowContext store/store.go:6",
      "types QueryRowContext store/store.go:6",
      "visits Exec store/store.go:7",
      "clinic.owners Get store/store.go:8",
      "pets Select store/store.go:9",
      "vets NamedExec store/store.go:10",
      "wrapped Query store/store.go:12",
    ]);
  });
});
