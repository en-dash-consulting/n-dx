/**
 * The Sidecar card contract the server and the drawer both read.
 *
 * Ending a session withdraws its waiting cards with this reason (UX8). The
 * drawer draws such a card as denied with the note "session ended", unlike a
 * card withdrawn because a turn stopped, so the reason is the shared signal.
 */
export const SIDECAR_SESSION_ENDED_REASON = "session ended";
