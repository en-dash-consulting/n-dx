/**
 * PRD view — displays Rex PRD hierarchy with interactive tree.
 *
 * Loads PRD data from /data/prd.json (served by the unified web server)
 * or accepts it via props.
 */

import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import { PRDTree } from "../components/prd-tree/index.js";
import type { PRDDocumentData } from "../components/prd-tree/index.js";

export interface PRDViewProps {
  /** Pre-loaded PRD data. If not provided, fetches from /data/prd.json. */
  prdData?: PRDDocumentData | null;
}

export function PRDView({ prdData }: PRDViewProps) {
  const [data, setData] = useState<PRDDocumentData | null>(prdData ?? null);
  const [loading, setLoading] = useState(!prdData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prdData) {
      setData(prdData);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPRD() {
      try {
        const res = await fetch("/data/prd.json");
        if (!res.ok) {
          if (res.status === 404) {
            setError("No PRD data found. Run 'rex init' then 'rex analyze' to create one.");
          } else {
            setError(`Failed to load PRD data (${res.status})`);
          }
          setLoading(false);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not fetch PRD data. Is the server running?");
          setLoading(false);
        }
      }
    }

    fetchPRD();
    return () => { cancelled = true; };
  }, [prdData]);

  if (loading) {
    return h("div", { class: "loading" }, "Loading PRD...");
  }

  if (error) {
    return h("div", { class: "prd-empty" },
      h("p", null, error),
    );
  }

  if (!data) {
    return h("div", { class: "prd-empty" },
      h("p", null, "No PRD data available."),
    );
  }

  return h(PRDTree, { document: data, defaultExpandDepth: 2 });
}
