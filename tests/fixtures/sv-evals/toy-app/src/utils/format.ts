export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatName(first: string, last: string): string {
  return `${first.trim()} ${last.trim()}`.trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
