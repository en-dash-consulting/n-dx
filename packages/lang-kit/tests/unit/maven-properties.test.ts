import { describe, expect, it } from "vitest";
import { interpolate, MAX_PROPERTY_NESTING, propertyContext } from "../../src/maven-properties.js";

/** Properties that count how often each name is looked up, i.e. expanded. */
class CountingProps extends Map<string, string> {
  readonly lookups = new Map<string, number>();
  override get(name: string): string | undefined {
    this.lookups.set(name, (this.lookups.get(name) ?? 0) + 1);
    return super.get(name);
  }
  maxLookups(): number {
    return Math.max(0, ...this.lookups.values());
  }
}

/** `p0=${p1}`, …, `p(n-1)=${pn}`, with `pn` left undefined. */
function failingChain(n: number): CountingProps {
  const props = new CountingProps();
  for (let i = 0; i < n; i++) props.set(`p${i}`, `\${p${i + 1}}`);
  return props;
}

describe("interpolate", () => {
  it("expands each property of a 1,500-deep failing chain at most once for 2,000 references", () => {
    const props = failingChain(1500);
    const ctx = propertyContext(props);
    for (let i = 0; i < 2000; i++) {
      expect(interpolate("${p0}", ctx)).toEqual({ resolved: false, reason: "property nesting too deep" });
    }
    expect(props.maxLookups()).toBe(1);
    expect(props.lookups.size).toBe(MAX_PROPERTY_NESTING + 1);
  });

  it("expands each property of a chain ending in an undefined property once, and keeps the reason", () => {
    const props = failingChain(MAX_PROPERTY_NESTING - 1);
    const ctx = propertyContext(props);
    const undefinedReason = { resolved: false, reason: `property p${MAX_PROPERTY_NESTING - 1} is not defined in the repository` };
    for (let i = 0; i < 2000; i++) expect(interpolate("${p0}", ctx)).toEqual(undefinedReason);
    // Reached directly, a member of the chain fails the same way without another walk.
    expect(interpolate("${p30}", ctx)).toEqual(undefinedReason);
    expect(props.maxLookups()).toBe(1);
  });

  it("expands each member of a cycle once", () => {
    const props = new CountingProps([["a", "${b}"], ["b", "${c}"], ["c", "${a}"]]);
    const ctx = propertyContext(props);
    for (let i = 0; i < 100; i++) {
      expect(interpolate("${a}", ctx)).toEqual({ resolved: false, reason: "property a refers to itself" });
      // The reason names the property that closed the cycle, wherever the cycle is entered later.
      expect(interpolate("${b}", ctx)).toEqual({ resolved: false, reason: "property a refers to itself" });
    }
    expect(props.maxLookups()).toBe(1);
  });

  it("gives a property the same result whether a shallow or a deep path reaches it first", () => {
    // `p0` nests one past the cap; `p1` alone is exactly at it.
    const chain = new Map<string, string>([[`p${MAX_PROPERTY_NESTING}`, "x"]]);
    for (let i = 0; i < MAX_PROPERTY_NESTING; i++) chain.set(`p${i}`, `\${p${i + 1}}`);
    const tooDeep = { resolved: false, reason: "property nesting too deep" };

    const shallowFirst = propertyContext(chain);
    expect(interpolate("${p1}", shallowFirst)).toEqual({ resolved: true, value: "x" });
    expect(interpolate("${p0}", shallowFirst)).toEqual(tooDeep);

    const deepFirst = propertyContext(chain);
    expect(interpolate("${p0}", deepFirst)).toEqual(tooDeep);
    expect(interpolate("${p1}", deepFirst)).toEqual({ resolved: true, value: "x" });
  });

  it("gives a failure the same reason whether a shallow or a deep path reaches it first", () => {
    // `d0` … `d59` lead to `q0`; `q0` … `q9` lead to the undefined `q10`.
    // From `d0` the cap is met at `q4`, before `q10` is reached.
    const props = new Map<string, string>();
    for (let i = 0; i < 60; i++) props.set(`d${i}`, `\${d${i + 1}}`);
    props.set("d60", "${q0}");
    for (let i = 0; i < 10; i++) props.set(`q${i}`, `\${q${i + 1}}`);
    const tooDeep = { resolved: false, reason: "property nesting too deep" };
    const missing = { resolved: false, reason: "property q10 is not defined in the repository" };

    const shallowFirst = propertyContext(props);
    expect(interpolate("${q0}", shallowFirst)).toEqual(missing);
    expect(interpolate("${d0}", shallowFirst)).toEqual(tooDeep);

    const deepFirst = propertyContext(props);
    expect(interpolate("${d0}", deepFirst)).toEqual(tooDeep);
    expect(interpolate("${q0}", deepFirst)).toEqual(missing);
  });
});
