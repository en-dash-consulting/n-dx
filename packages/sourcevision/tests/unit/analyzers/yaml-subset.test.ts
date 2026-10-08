/**
 * The YAML subset.
 *
 * Two things are being tested, and the second matters more. First, that the
 * shapes real CI files use actually parse. Second, that the constructs the
 * subset does *not* support throw rather than returning a half-read document:
 * a CI job silently missing its steps reads downstream as "this project does
 * not test", which is a worse answer than "this file could not be read".
 *
 * @see src/analyzers/yaml-subset.ts
 */
import { describe, it, expect } from "vitest";
import {
  parseYamlSubset,
  YamlSubsetError,
  isMap,
  listAt,
  stringAt,
} from "../../../src/analyzers/yaml-subset.js";

describe("mappings and scalars", () => {
  it("reads nested maps", () => {
    expect(parseYamlSubset("name: ci\non:\n  push:\n    branches: [main]\n")).toEqual({
      name: "ci",
      on: { push: { branches: ["main"] } },
    });
  });

  it("coerces the scalars YAML gives meaning to", () => {
    expect(parseYamlSubset("a: 1\nb: 2.5\nc: true\nd: false\ne: null\nf: ~\ng: text\n")).toEqual({
      a: 1, b: 2.5, c: true, d: false, e: null, f: null, g: "text",
    });
  });

  it("keeps a quoted scalar as text", () => {
    // "1" is a version string, not the number one.
    expect(parseYamlSubset('version: "1"\nname: "true"\n')).toEqual({ version: "1", name: "true" });
  });

  it("keeps a colon inside a quoted value", () => {
    expect(parseYamlSubset('run: echo "a: b"\n')).toEqual({ run: 'echo "a: b"' });
  });

  it("strips comments but not a # inside a value", () => {
    expect(parseYamlSubset("a: one # trailing\nb: '#notacomment'\nc: http://x/#frag\n")).toEqual({
      a: "one", b: "#notacomment", c: "http://x/#frag",
    });
  });
});

describe("sequences", () => {
  it("reads a scalar sequence", () => {
    expect(parseYamlSubset("steps:\n  - one\n  - two\n")).toEqual({ steps: ["one", "two"] });
  });

  it("reads a sequence of maps, including keys after the dash line", () => {
    const doc = parseYamlSubset(
      "steps:\n" +
      "  - name: checkout\n" +
      "    uses: actions/checkout@v4\n" +
      "  - name: test\n" +
      "    run: pnpm test\n",
    );
    expect(doc).toEqual({
      steps: [
        { name: "checkout", uses: "actions/checkout@v4" },
        { name: "test", run: "pnpm test" },
      ],
    });
  });

  it("reads an item whose content is the block beneath the dash", () => {
    expect(parseYamlSubset("items:\n  -\n    a: 1\n    b: 2\n")).toEqual({ items: [{ a: 1, b: 2 }] });
  });

  it("reads inline flow collections", () => {
    expect(parseYamlSubset("a: [1, two, 'three']\nb: {k: v, n: 2}\n")).toEqual({
      a: [1, "two", "three"], b: { k: "v", n: 2 },
    });
  });

  it("does not split a comma inside a quoted flow item", () => {
    expect(parseYamlSubset("a: ['x,y', z]\n")).toEqual({ a: ["x,y", "z"] });
  });

  it("reads a sequence at the same indent as the key that owns it", () => {
    // The GitLab CI docs and many workflows write `steps:` and its dashes at
    // one column. Reading that as "no value" dropped every job after it.
    const doc = parseYamlSubset(
      "jobs:\n" +
      "  test:\n" +
      "    steps:\n" +
      "    - run: npm test\n" +
      "  deploy:\n" +
      "    steps:\n" +
      "      - run: ./deploy.sh\n",
    );
    expect(doc).toEqual({
      jobs: {
        test: { steps: [{ run: "npm test" }] },
        deploy: { steps: [{ run: "./deploy.sh" }] },
      },
    });
  });

  it("reads a top-level sequence at the same indent as its key", () => {
    expect(parseYamlSubset("on:\n- push\n- pull_request\njobs:\n  x: 1\n")).toEqual({
      on: ["push", "pull_request"],
      jobs: { x: 1 },
    });
  });
});

describe("block scalars", () => {
  it("keeps newlines for |", () => {
    expect(parseYamlSubset("run: |\n  one\n  two\n")).toEqual({ run: "one\ntwo" });
  });

  it("folds for >", () => {
    expect(parseYamlSubset("run: >\n  one\n  two\n")).toEqual({ run: "one two" });
  });

  it("accepts the chomping indicators", () => {
    expect(parseYamlSubset("a: |-\n  x\nb: >-\n  y\n")).toEqual({ a: "x", b: "y" });
  });

  it("keeps a tab inside a block scalar body", () => {
    // A heredoc in a `run: |` script is content; only indentation refuses tabs.
    expect(parseYamlSubset("run: |\n  cat <<EOF\n  \tx\n  EOF\n")).toEqual({ run: "cat <<EOF\n\tx\nEOF" });
  });

  it("keeps the relative indentation of a block scalar body", () => {
    expect(parseYamlSubset("run: |\n  if x; then\n    y\n  fi\n")).toEqual({ run: "if x; then\n  y\nfi" });
  });
});

describe("refuses rather than guesses", () => {
  // Each of these changes what the document means. Returning a partial parse
  // would hand the caller a file that looks complete and is not.
  const REFUSED: Array<[string, string, string]> = [
    ["anchors", "base: &defaults\n  a: 1\n", "anchors"],
    ["aliases", "a: 1\nb: *defaults\n", "aliases"],
    ["merge keys", "job:\n  <<: *defaults\n", "merge keys"],
    ["explicit tags", "a: !!str 1\n", "tags"],
    ["multi-document streams", "a: 1\n---\nb: 2\n", "Multi-document"],
    ["tab indentation", "a:\n\tb: 1\n", "Tab"],
  ];

  for (const [name, source, fragment] of REFUSED) {
    it(`throws on ${name}`, () => {
      expect(() => parseYamlSubset(source)).toThrow(YamlSubsetError);
      expect(() => parseYamlSubset(source)).toThrow(new RegExp(fragment, "i"));
    });
  }

  it("reports the line it gave up on", () => {
    try {
      parseYamlSubset("a: 1\nb: 2\nc: !!str 3\n");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(YamlSubsetError);
      expect((error as YamlSubsetError).line).toBe(3);
    }
  });

  it("throws on a line that is neither a key nor a sequence item", () => {
    expect(() => parseYamlSubset("a: 1\njust some prose\n")).toThrow(YamlSubsetError);
  });

  it("throws on an unterminated quote in a flow collection", () => {
    expect(() => parseYamlSubset("a: ['x, y]\n")).toThrow(YamlSubsetError);
  });

  it("throws, naming the line, when a line is left unconsumed", () => {
    // A stray line no container claims used to be dropped along with
    // everything after it, returning a document that looked complete.
    try {
      parseYamlSubset("a:\n    b: 1\n  c: 2\nd: 3\n");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(YamlSubsetError);
      expect((error as YamlSubsetError).message).toMatch(/Unexpected content/);
      expect((error as YamlSubsetError).line).toBe(3);
    }
  });

  it("still refuses a tab that indents structure, even where no container claims the line", () => {
    expect(() => parseYamlSubset("a: 1\n\tb: 2\n")).toThrow(/Tab/);
  });
});

describe("encodings editors produce", () => {
  it("ignores a leading byte-order mark", () => {
    // Without this the BOM counted as indentation, the first line became a
    // one-column block, and the rest of the workflow was silently discarded.
    const bom = String.fromCharCode(0xfeff);
    expect(parseYamlSubset(bom + "name: CI\non: push\njobs:\n  x:\n    steps:\n      - run: echo\n")).toEqual({
      name: "CI",
      on: "push",
      jobs: { x: { steps: [{ run: "echo" }] } },
    });
  });

  it("reads CRLF line endings", () => {
    expect(parseYamlSubset("name: CI\r\non: push\r\njobs:\r\n  x:\r\n    steps:\r\n      - run: echo\r\n")).toEqual({
      name: "CI",
      on: "push",
      jobs: { x: { steps: [{ run: "echo" }] } },
    });
  });
});

describe("empty and trivial documents", () => {
  it("reads an empty document as null", () => {
    expect(parseYamlSubset("")).toBeNull();
    expect(parseYamlSubset("# only a comment\n")).toBeNull();
  });

  it("allows a leading document separator", () => {
    expect(parseYamlSubset("---\na: 1\n")).toEqual({ a: 1 });
  });
});

describe("readers", () => {
  const doc = parseYamlSubset("name: ci\non: push\ntags: [a, b]\njobs:\n  build:\n    x: 1\n  test:\n    y: 2\n");

  it("isMap distinguishes a map from a sequence", () => {
    expect(isMap(doc)).toBe(true);
    expect(isMap(["a"])).toBe(false);
    expect(isMap(null)).toBe(false);
  });

  it("stringAt returns only strings", () => {
    expect(stringAt(doc, "name")).toBe("ci");
    expect(stringAt(doc, "jobs")).toBeUndefined();
    expect(stringAt(doc, "missing")).toBeUndefined();
  });

  it("listAt normalises the three ways CI files write a list", () => {
    expect(listAt(doc, "on")).toEqual(["push"]);          // a bare scalar
    expect(listAt(doc, "tags")).toEqual(["a", "b"]);      // a sequence
    expect(listAt(doc, "jobs")).toEqual(["build", "test"]); // a map's keys
    expect(listAt(doc, "missing")).toEqual([]);
  });
});

describe("a realistic GitHub Actions workflow", () => {
  const WORKFLOW = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: pnpm install
      - name: Test
        run: |
          pnpm test
          pnpm typecheck
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy
        run: ./deploy.sh production
`;

  it("parses jobs and their steps", () => {
    const doc = parseYamlSubset(WORKFLOW) as Record<string, never>;
    expect(stringAt(doc, "name")).toBe("CI");
    expect(listAt(doc, "on")).toEqual(["push", "pull_request"]);
    expect(listAt(doc, "jobs")).toEqual(["build", "deploy"]);

    const jobs = (doc as Record<string, Record<string, Record<string, unknown>>>)["jobs"];
    const steps = jobs["build"]["steps"] as Array<Record<string, string>>;
    expect(steps).toHaveLength(3);
    expect(steps[0]["uses"]).toBe("actions/checkout@v4");
    expect(steps[2]["run"]).toBe("pnpm test\npnpm typecheck");

    const deploySteps = jobs["deploy"]["steps"] as Array<Record<string, string>>;
    expect(deploySteps[0]["run"]).toBe("./deploy.sh production");
  });
});
