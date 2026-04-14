/**
 * Post-run token validation hook.
 *
 * Optional integration point for token validation during run finalization.
 * Called if enabled in `.n-dx.json` config.
 *
 * This is a lightweight, non-blocking validation that logs warnings
 * but never fails the run itself.
 */

import { validateTokenReporting, validateVendorAttribution } from "./token-validation.js";
import type { RunRecord } from "../schema/index.js";
import { detail, stream } from "../types/output.js";

/**
 * Perform post-run token validation.
 *
 * Validates the run's token reporting and vendor attribution.
 * Logs warnings but never throws — validation failures must not
 * fail the run itself.
 *
 * @param run Completed run record
 * @param enabled If false, returns immediately
 */
export function validateRunTokensPostRun(run: RunRecord, enabled = true): void {
  if (!enabled) return;

  try {
    const isCodex = run.turnTokenUsage?.some((t) => t.vendor === "codex") ?? false;
    if (!isCodex) {
      // Skip validation for Claude runs — they're expected and validated separately
      return;
    }

    // Validate token reporting
    const result = validateTokenReporting(run);

    if (!result.ok) {
      stream("Token Validation", `⚠ ${result.issues.length} issue(s) detected`);
      for (const issue of result.issues) {
        if (issue.severity === "error") {
          detail(`✗ ${issue.message}`);
        } else {
          detail(`⚠ ${issue.message}`);
        }
      }
    }

    // Validate vendor attribution
    const attributionIssues = validateVendorAttribution(run);
    if (attributionIssues.length > 0) {
      stream("Vendor Attribution", `⚠ ${attributionIssues.length} issue(s) detected`);
      for (const issue of attributionIssues) {
        detail(`⚠ ${issue}`);
      }
    }

    // Log summary
    if (result.ok && attributionIssues.length === 0) {
      detail(`✓ Tokens validated: ${result.metrics.totalInput} in / ${result.metrics.totalOutput} out`);
    }
  } catch (err) {
    // Swallow errors — post-run validation must never crash
    detail(`Token validation error (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}
