/**
 * Hook for fetching and parsing index.md schema sections.
 *
 * Fetches the generated index.md file for a PRD item and parses it into
 * structured sections (progress table, commits, changes, etc.).
 *
 * @module web/viewer/hooks/use-index-md
 */

import { useState, useEffect } from "preact/hooks";
import { parseIndexMd, type IndexMdSections } from "../utils/index-md-parser.js";

export interface UseIndexMdResult {
  sections: IndexMdSections | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch and parse index.md for a PRD item.
 *
 * @param itemId - The PRD item ID
 * @returns sections, loading state, and error message
 */
export function useIndexMd(itemId: string | null): UseIndexMdResult {
  const [sections, setSections] = useState<IndexMdSections | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) {
      setSections(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/rex/items/${itemId}/index-md`)
      .then((res) => {
        if (!res.ok) {
          // 404 is expected for items without index.md yet
          if (res.status === 404) {
            setSections(null);
            return null;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
      })
      .then((markdown) => {
        if (markdown) {
          try {
            const parsed = parseIndexMd(markdown);
            setSections(parsed);
          } catch (err) {
            setError(`Failed to parse index.md: ${String(err)}`);
            setSections(null);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(`Failed to fetch index.md: ${String(err)}`);
        setSections(null);
        setLoading(false);
      });
  }, [itemId]);

  return { sections, loading, error };
}
