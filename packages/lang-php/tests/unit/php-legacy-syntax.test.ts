/**
 * The same-length rewrite of PHP 5 brace offsets (`$s{0}` → `$s[0]`) that
 * lets the PHP 8 grammar parse legacy files. Invented sources only.
 */

import { describe, expect, it } from "vitest";
import { rewriteLegacySyntax } from "../../src/php-legacy-syntax.js";

const rewrite = (source: string) => rewriteLegacySyntax(source)?.source;

describe("rewriteLegacySyntax", () => {
  it("rewrites offsets on variables, properties and array elements, keeping the length", () => {
    const source = "<?php\n$c = $s{0};\n$d = $this->name{$i + 1};\n$e = $rows[2]{0};\n";
    const result = rewriteLegacySyntax(source);
    expect(result?.source).toBe("<?php\n$c = $s[0];\n$d = $this->name[$i + 1];\n$e = $rows[2][0];\n");
    expect(result?.source.length).toBe(source.length);
    expect(result?.rewrites).toEqual([
      { construct: "brace-offset", position: { line: 2, column: 7 } },
      { construct: "brace-offset", position: { line: 3, column: 16 } },
      { construct: "brace-offset", position: { line: 4, column: 13 } },
    ]);
  });

  it("rewrites nested offsets and offsets in conditions and assignments", () => {
    expect(rewrite("<?php if ($a{$b{0}} == 'x') { $s{1} = 'y'; }")).toBe("<?php if ($a[$b[0]] == 'x') { $s[1] = 'y'; }");
  });

  it("leaves blocks, interpolation, variable variables and property names alone", () => {
    const untouched = [
      "<?php if ($a) { foo(); } else { bar(); }",
      '<?php echo "{$s} and ${name} and {$a->b{0}}";',
      "<?php $x = ${'name'}; $y = $this->{$prop};",
      "<?php function f($x) { return function () use ($x) { return $x; }; }",
      "<?php class A extends B { public function c() {} }",
    ];
    for (const source of untouched) expect(rewriteLegacySyntax(source)).toBeUndefined();
  });

  it("skips strings, comments, heredocs, nowdocs and inline HTML", () => {
    const source = [
      "<p>$s{0}</p>",
      "<?php",
      "// $s{0}",
      "# $s{0}",
      "/* $s{0} */",
      "$a = '$s{0}';",
      "$b = <<<EOT",
      "$s{0}",
      "EOT;",
      "$c = <<<'EOT'",
      "$s{0}",
      "EOT;",
      "$d = $t{0};",
      "?><?xml version=\"1.0\"?><x>$s{0}</x>",
    ].join("\n");
    const result = rewriteLegacySyntax(source);
    expect(result?.rewrites.map((r) => r.position)).toEqual([{ line: 13, column: 7 }]);
    expect(result?.source.split("\n")[12]).toBe("$d = $t[0];");
  });

  it("handles short open tags and echo tags", () => {
    expect(rewrite("<? $a = $s{0}; ?>x<?= $s{1} ?>")).toBe("<? $a = $s[0]; ?>x<?= $s[1] ?>");
  });

  it("leaves an offset whose closing brace never comes", () => {
    expect(rewriteLegacySyntax("<?php $a = $s{0;")).toBeUndefined();
  });
});
