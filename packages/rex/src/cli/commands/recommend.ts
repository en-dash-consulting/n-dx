import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { PROJECT_DIRS } from "@n-dx/llm-client";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";
import type { PRDItem, ItemLevel } from "../../schema/index.js";
import { randomUUID } from "node:crypto";
import {
  computeFindingHash,
  loadAcknowledged,
  saveAcknowledged,
  acknowledgeFinding,
  isAcknowledged,
} from "../../analyze/acknowledge.js";

interface Finding {
  severity: string;
  category: string;
  message: string;
  file?: string;
  hash: string;
}

interface Recommendation {
  title: string;
  level: ItemLevel;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  source: string;
}

function selectorFormatError(detail: string): Error {
  return new Error(`${detail}\nExample: rex recommend --accept='=1,4,5' .`);
}

export function parseSelectionIndices(input: string, total: number): number[] {
  const raw = input.trim();
  if (!raw.startsWith("=")) {
    throw selectorFormatError("Invalid --accept selector format. Expected '=N[,M,...]'.");
  }

  const normalized = raw.slice(1).trim();
  if (!normalized) {
    throw selectorFormatError("Invalid --accept selector format. Expected one or more indices after '='.");
  }
  if (normalized === "all") return [];

  const values = normalized
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (values.length === 0) {
    throw selectorFormatError("Invalid --accept selector format. Expected one or more indices after '='.");
  }

  const selected = new Set<number>();
  for (const value of values) {
    if (!/^\d+$/.test(value)) {
      throw selectorFormatError(
        `Invalid --accept selector token '${value}'. Expected numeric indices like '=1,4,5'.`,
      );
    }
    const parsed = Number.parseInt(value, 10);
    if (parsed < 1 || parsed > total) {
      throw new Error(
        `Invalid --accept selector index ${parsed}. Index must be between 1 and ${total}.`,
      );
    }
    selected.add(parsed - 1);
  }

  return [...selected].sort((a, b) => a - b);
}

async function detectSourceVision(dir: string): Promise<boolean> {
  try {
    await access(join(dir, PROJECT_DIRS.SOURCEVISION));
    return true;
  } catch {
    return false;
  }
}

interface RawFinding {
  type?: string;
  severity?: string;
  text?: string;
  message?: string;
  scope?: string;
  category?: string;
  file?: string;
}

async function readFindings(
  dir: string,
  severities: string[],
): Promise<Finding[]> {
  const zonesPath = join(dir, PROJECT_DIRS.SOURCEVISION, "zones.json");
  const raw = await readFile(zonesPath, "utf-8");
  const data = JSON.parse(raw);

  const rawFindings: RawFinding[] = data.findings ?? [];
  const sevSet = new Set(severities);

  return rawFindings
    .filter((f) => f.severity && sevSet.has(f.severity))
    .map((f) => ({
      severity: f.severity!,
      category: f.category ?? f.type ?? "general",
      message: f.message ?? f.text ?? "",
      file: f.file,
      hash: computeFindingHash({
        type: f.type ?? "general",
        scope: f.scope ?? "global",
        text: f.message ?? f.text ?? "",
      }),
    }));
}

function mapFindingsToRecommendations(findings: Finding[]): Recommendation[] {
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const group = grouped.get(f.category) ?? [];
    group.push(f);
    grouped.set(f.category, group);
  }

  const recommendations: Recommendation[] = [];
  for (const [category, items] of grouped) {
    const hasCritical = items.some((f) => f.severity === "critical");
    recommendations.push({
      title: `Address ${category} issues (${items.length} findings)`,
      level: "feature",
      description: items.map((f) => `- ${f.message}`).join("\n"),
      priority: hasCritical ? "critical" : "high",
      source: "sourcevision",
    });
  }

  return recommendations;
}

export async function cmdRecommend(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const hasSourceVision = await detectSourceVision(dir);
  if (!hasSourceVision) {
    result("SourceVision not detected.");
    info("Run 'sourcevision analyze' first, or pass a project with .sourcevision/");
    return;
  }

  let allFindings: Finding[];
  try {
    allFindings = await readFindings(dir, ["warning", "critical"]);
  } catch (err) {
    console.error("Failed to read SourceVision findings:", (err as Error).message);
    return;
  }

  const rexDir = join(dir, REX_DIR);
  const ackStore = await loadAcknowledged(rexDir);

  // Handle --acknowledge flag
  if (flags.acknowledge) {
    const showAll = flags["show-all"] !== undefined;
    const findings = showAll
      ? allFindings
      : allFindings.filter((f) => !isAcknowledged(ackStore, f.hash));

    if (flags.acknowledge === "all") {
      let updated = ackStore;
      for (const f of findings) {
        updated = acknowledgeFinding(updated, f.hash, f.message, "acknowledged", "user");
      }
      await saveAcknowledged(rexDir, updated);
      result(`Acknowledged all ${findings.length} findings.`);
      return;
    }

    const indices = flags.acknowledge.split(",").map((s) => parseInt(s.trim(), 10));
    let updated = ackStore;
    const acked: string[] = [];
    for (const idx of indices) {
      const f = findings[idx - 1]; // 1-based index
      if (!f) {
        console.error(`Finding index ${idx} out of range (1-${findings.length}).`);
        continue;
      }
      updated = acknowledgeFinding(updated, f.hash, f.message, "acknowledged", "user");
      acked.push(`${idx}. ${f.message.slice(0, 60)}`);
    }
    await saveAcknowledged(rexDir, updated);
    for (const a of acked) result(`Acknowledged: ${a}`);
    return;
  }

  // Filter acknowledged findings unless --show-all
  const showAll = flags["show-all"] !== undefined;
  const findings = showAll
    ? allFindings
    : allFindings.filter((f) => !isAcknowledged(ackStore, f.hash));
  const acknowledgedCount = allFindings.length - allFindings.filter((f) => !isAcknowledged(ackStore, f.hash)).length;

  if (findings.length === 0) {
    result("No findings to recommend.");
    if (acknowledgedCount > 0) {
      info(`(${acknowledgedCount} finding${acknowledgedCount === 1 ? "" : "s"} acknowledged, use --show-all to include)`);
    }
    return;
  }

  const recommendations = mapFindingsToRecommendations(findings);

  if (flags.format === "json") {
    result(JSON.stringify(recommendations, null, 2));
    return;
  }

  result(`\n${recommendations.length} recommended items:\n`);
  let displayIdx = 0;
  for (const rec of recommendations) {
    result(`  [${rec.priority}] ${rec.title}`);
    for (const line of rec.description.split("\n")) {
      displayIdx++;
      const finding = findings.find((f) => line.includes(f.message));
      const ackMarker = showAll && finding && isAcknowledged(ackStore, finding.hash) ? " (acknowledged)" : "";
      info(`    ${displayIdx}. ${line.replace(/^- /, "")}${ackMarker}`);
    }
    info("");
  }

  if (acknowledgedCount > 0) {
    info(`(${acknowledgedCount} finding${acknowledgedCount === 1 ? "" : "s"} acknowledged, use --show-all to include)`);
  }

  if (flags.accept) {
    const store = await resolveStore(rexDir);
    const acceptFlag = flags.accept.trim();
    const usesSelectorMode = acceptFlag !== "true";
    if (usesSelectorMode && !acceptFlag.startsWith("=")) {
      throw selectorFormatError(
        "Invalid --accept selector format. Expected '=N[,M,...]' when passing a selector.",
      );
    }

    const selectedIndices = usesSelectorMode
      ? (acceptFlag === "=all" ? null : parseSelectionIndices(acceptFlag, recommendations.length))
      : null;
    const acceptedRecommendations = selectedIndices === null
      ? recommendations
      : selectedIndices.map((i) => recommendations[i]).filter(Boolean);

    if (acceptedRecommendations.length === 0) {
      info("No recommendations matched the selected indices.");
      return;
    }

    for (const rec of acceptedRecommendations) {
      const item: PRDItem = {
        id: randomUUID(),
        title: rec.title,
        level: rec.level,
        status: "pending",
        description: rec.description,
        priority: rec.priority,
        source: rec.source,
      };
      await store.addItem(item);
      result(`Added: ${rec.title} (${item.id})`);
    }
  } else {
    info("Run with --accept to add all recommendations to the PRD.");
    info("Run with --acknowledge=1,2 to acknowledge specific findings.");
  }
}
