export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function formatEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
