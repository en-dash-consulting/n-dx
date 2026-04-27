import { useEffect, useState } from "react";

export function useFetch<T>(url: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let aborted = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => !aborted && setData(d as T))
      .catch((e) => !aborted && setError(String(e)));
    return () => {
      aborted = true;
    };
  }, [url]);
  return { data, error };
}
