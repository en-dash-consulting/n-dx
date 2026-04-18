export function parseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(qs);
  for (const [k, v] of params) out[k] = v;
  return out;
}
