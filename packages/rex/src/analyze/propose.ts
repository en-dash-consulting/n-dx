import type { ScanResult } from "./scanners.js";
import { deduplicateScanResults } from "./dedupe.js";

export interface ProposalTask {
  title: string;
  source: string;
  sourceFile: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
}

export interface ProposalFeature {
  title: string;
  source: string;
  description?: string;
  tasks: ProposalTask[];
}

export interface Proposal {
  epic: { title: string; source: string };
  features: ProposalFeature[];
}

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function inferEpic(result: ScanResult): string {
  // Use first tag as epic grouping (scanners set this to directory-inferred epic)
  if (result.tags && result.tags.length > 0) {
    return result.tags[0];
  }
  // Fall back to source type
  return result.source === "sourcevision"
    ? "SourceVision"
    : result.source === "test"
      ? "Tests"
      : "Documentation";
}

export function buildProposals(results: ScanResult[]): Proposal[] {
  // Deduplicate within proposal set: merge near-duplicates by kind
  const deduped = deduplicateScanResults(results);

  // Separate by kind
  const epics = deduped.filter((r) => r.kind === "epic");
  const features = deduped.filter((r) => r.kind === "feature");
  const tasks = deduped.filter((r) => r.kind === "task");

  // Group features and tasks by epic
  const epicMap = new Map<string, { source: string; features: Map<string, { result: ScanResult; tasks: ScanResult[] }> }>();

  // Seed from explicit epics
  for (const e of epics) {
    if (!epicMap.has(normalize(e.name))) {
      epicMap.set(normalize(e.name), {
        source: e.source,
        features: new Map(),
      });
    }
  }

  // Place features under epics
  for (const f of features) {
    const epicName = normalize(inferEpic(f));
    if (!epicMap.has(epicName)) {
      epicMap.set(epicName, { source: f.source, features: new Map() });
    }
    const epic = epicMap.get(epicName)!;
    const fKey = normalize(f.name);
    if (!epic.features.has(fKey)) {
      epic.features.set(fKey, { result: f, tasks: [] });
    }
  }

  // Place tasks under features (match by tags or sourceFile)
  for (const t of tasks) {
    const epicName = normalize(inferEpic(t));
    if (!epicMap.has(epicName)) {
      epicMap.set(epicName, { source: t.source, features: new Map() });
    }
    const epic = epicMap.get(epicName)!;

    // Try to find a matching feature by sourceFile
    let placed = false;
    for (const [, feat] of epic.features) {
      if (feat.result.sourceFile === t.sourceFile) {
        feat.tasks.push(t);
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Create an implicit feature from the task's source file
      const implicitName = normalize(t.sourceFile || t.name);
      if (!epic.features.has(implicitName)) {
        epic.features.set(implicitName, {
          result: {
            name: t.sourceFile || t.name,
            source: t.source,
            sourceFile: t.sourceFile,
            kind: "feature",
          },
          tasks: [],
        });
      }
      epic.features.get(implicitName)!.tasks.push(t);
    }
  }

  // Build final proposals
  const proposals: Proposal[] = [];
  for (const [epicKey, epicData] of epicMap) {
    const featureList: ProposalFeature[] = [];
    for (const [, feat] of epicData.features) {
      // Sort tasks by priority
      const sortedTasks = feat.tasks.sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority ?? "medium"] ?? 2) -
          (PRIORITY_ORDER[b.priority ?? "medium"] ?? 2),
      );

      featureList.push({
        title: feat.result.name,
        source: feat.result.source,
        description: feat.result.description,
        tasks: sortedTasks.map((t) => ({
          title: t.name,
          source: t.source,
          sourceFile: t.sourceFile,
          description: t.description,
          acceptanceCriteria: t.acceptanceCriteria,
          priority: t.priority,
          tags: t.tags,
        })),
      });
    }

    // Sort features: those with higher-priority tasks first
    featureList.sort((a, b) => {
      const aPri = Math.min(
        ...a.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
        2,
      );
      const bPri = Math.min(
        ...b.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
        2,
      );
      return aPri - bPri;
    });

    // Use original casing for epic title from the first entry
    const epicTitle =
      epics.find((e) => normalize(e.name) === epicKey)?.name ??
      features.find((f) => normalize(inferEpic(f)) === epicKey)?.tags?.[0] ??
      epicKey;

    proposals.push({
      epic: { title: epicTitle, source: epicData.source },
      features: featureList,
    });
  }

  // Sort proposals: those with higher-priority content first
  proposals.sort((a, b) => {
    const aPri = Math.min(
      ...a.features.flatMap((f) =>
        f.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
      ),
      2,
    );
    const bPri = Math.min(
      ...b.features.flatMap((f) =>
        f.tasks.map((t) => PRIORITY_ORDER[t.priority ?? "medium"] ?? 2),
      ),
      2,
    );
    return aPri - bPri;
  });

  return proposals;
}
