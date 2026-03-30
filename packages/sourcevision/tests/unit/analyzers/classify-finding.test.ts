import { describe, it, expect } from "vitest";
import { classifyFinding } from "../../../src/analyzers/enrich-parsing.js";

describe("classifyFinding", () => {
  describe("structural findings", () => {
    it("classifies zone boundary opinions", () => {
      expect(classifyFinding("This zone spans 17 directories and should be split")).toBe("structural");
    });

    it("classifies file placement suggestions", () => {
      expect(classifyFinding("EventItemPopover.jsx belongs in the shared-components zone")).toBe("structural");
    });

    it("classifies directory sprawl", () => {
      expect(classifyFinding("Directory sprawl: files scattered across 5 unrelated directories")).toBe("structural");
    });

    it("classifies zone merging suggestions", () => {
      expect(classifyFinding("These two zones should be merged — they serve the same purpose")).toBe("structural");
    });

    it("classifies zone splitting suggestions", () => {
      expect(classifyFinding("Split this zone into separate data and UI concerns")).toBe("structural");
    });

    it("classifies too many files observations", () => {
      expect(classifyFinding("Zone has too many files (51) for its scope")).toBe("structural");
    });

    it("classifies zone-level coupling", () => {
      expect(classifyFinding("Zone-level coupling between scheduler and examples is high")).toBe("structural");
    });

    it("classifies file misplacement", () => {
      expect(classifyFinding("class-based.jsx is misplaced — should move to examples zone")).toBe("structural");
    });
  });

  describe("code findings", () => {
    it("classifies duplication", () => {
      expect(classifyFinding("Duplicated conflict detection algorithm in two modules")).toBe("code");
    });

    it("classifies circular dependencies", () => {
      expect(classifyFinding("Circular dependency between scheduler-core and examples")).toBe("code");
    });

    it("classifies god functions", () => {
      expect(classifyFinding("God function: handleDrop has 45 outgoing calls")).toBe("code");
    });

    it("classifies unused exports", () => {
      expect(classifyFinding("Unused export: formatDate is never imported")).toBe("code");
    });

    it("classifies anti-patterns", () => {
      expect(classifyFinding("Anti-pattern: direct DOM manipulation in React component")).toBe("code");
    });

    it("classifies tight coupling", () => {
      expect(classifyFinding("Tightly coupled modules: scheduler.js and config.js share 12 edges")).toBe("code");
    });

    it("classifies missing abstractions", () => {
      expect(classifyFinding("Missing abstraction layer between data fetching and UI")).toBe("code");
    });

    it("classifies leaky abstractions", () => {
      expect(classifyFinding("Leaky abstraction: UI components access internal database details")).toBe("code");
    });

    it("classifies fan-in hotspots", () => {
      expect(classifyFinding("Fan-in hotspot: utils.js imported by 23 files")).toBe("code");
    });

    it("classifies hub functions", () => {
      expect(classifyFinding("Hub function: processEvent called from 15 different files")).toBe("code");
    });
  });

  describe("documentation findings", () => {
    it("classifies naming inconsistencies", () => {
      expect(classifyFinding("Naming inconsistency: mix of camelCase and snake_case in exports")).toBe("documentation");
    });

    it("classifies undocumented conventions", () => {
      expect(classifyFinding("Undocumented convention: all services must export a default factory")).toBe("documentation");
    });

    it("classifies missing documentation", () => {
      expect(classifyFinding("JSDoc comments missing for public API functions")).toBe("documentation");
    });
  });

  describe("priority: code over structural", () => {
    it("classifies circular dependency mentioning zones as code (not structural)", () => {
      // "circular dependency" is a code issue even when it mentions zones
      expect(classifyFinding("Circular dependency between zone-a and zone-b")).toBe("code");
    });

    it("classifies tight coupling mentioning zones as code", () => {
      expect(classifyFinding("Tightly coupled: zone-a depends on zone-b internals")).toBe("code");
    });
  });

  describe("unclassified findings", () => {
    it("returns undefined for generic observations", () => {
      expect(classifyFinding("This zone has 12 files and handles authentication")).toBeUndefined();
    });

    it("returns undefined for positive observations", () => {
      expect(classifyFinding("Clean separation of concerns with well-defined interfaces")).toBeUndefined();
    });
  });
});
