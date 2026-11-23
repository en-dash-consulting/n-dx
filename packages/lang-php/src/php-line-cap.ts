/**
 * The longest line the configuration readers parse (`.htaccess`, `php.ini`,
 * `.user.ini`). Their content is the analysed repository's, so a longer line
 * is skipped and counted in a notice rather than read.
 */

/** 64 KiB, in UTF-16 code units. */
export const MAX_CONFIG_LINE_LENGTH = 64 * 1024;

/** Whether a line is past {@link MAX_CONFIG_LINE_LENGTH}. */
export const isOverlongLine = (line: string): boolean => line.length > MAX_CONFIG_LINE_LENGTH;

/** The notice for `count` skipped lines of `file`, read for `what` (plural: `include_path settings`). */
export const overlongLinesNotice = (file: string, count: number, what: string): string =>
  `${file}: skipped ${count} line${count === 1 ? "" : "s"} longer than ${MAX_CONFIG_LINE_LENGTH / 1024} KiB; any ${what} there are not read.`;
