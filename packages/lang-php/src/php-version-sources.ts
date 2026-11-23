/**
 * The php.net page a PHP version boundary cites, shared by the version-floor
 * (`php-compat.ts`) and legacy-construct (`php-legacy.ts`) rules.
 *
 * From 5.6 on, a boundary cites that version's migration guide page
 * (`https://www.php.net/manual/en/migrationXY.<section>.php`). php.net no
 * longer hosts the guides for 5.3, 5.4 and 5.5 (their pages answer 404), so
 * those boundaries cite the release's anchor in the PHP 5 changelog
 * (`https://www.php.net/ChangeLog-5.php#5.X.0`). No rule names an older version.
 *
 * @module lang-php/php-version-sources
 */

const MANUAL = "https://www.php.net/manual/en/";
const CHANGELOG_5 = "https://www.php.net/ChangeLog-5.php";

/** The versions whose boundaries cite the PHP 5 changelog. */
const CHANGELOG_VERSIONS: readonly string[] = ["5.3", "5.4", "5.5"];

const MIGRATION_PAGE = /^https:\/\/www\.php\.net\/manual\/en\/migration(\d)(\d)\.[a-z-]+\.php$/;
const CHANGELOG_ANCHOR = /^https:\/\/www\.php\.net\/ChangeLog-5\.php#(5\.\d)\.0$/;

/** Is `major.minor` 5.6 or later? */
function hasMigrationGuide(version: string): boolean {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  if (match === null) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 5 || (major === 5 && minor >= 6);
}

/**
 * The page a boundary at `version` cites: the changelog anchor for 5.3 to
 * 5.5, else the migration guide's `section` page (`new-features`,
 * `deprecated`, `incompatible`, …). Throws for a version neither covers.
 */
export function phpVersionSource(version: string, section: string): string {
  if (CHANGELOG_VERSIONS.includes(version)) return `${CHANGELOG_5}#${version}.0`;
  if (hasMigrationGuide(version)) return `${MANUAL}migration${version.replace(".", "")}.${section}.php`;
  throw new Error(`PHP ${version} has no php.net page a rule may cite`);
}

/** The name of the document {@link phpVersionSource} cites for `version`. */
export function phpVersionSourceName(version: string): string {
  return CHANGELOG_VERSIONS.includes(version) ? "PHP 5 changelog" : `PHP ${version} migration guide`;
}

/**
 * The `major.minor` version a boundary's source cites, or `undefined` when
 * the source is neither form {@link phpVersionSource} gives.
 */
export function citedPhpVersion(source: string): string | undefined {
  const page = MIGRATION_PAGE.exec(source);
  if (page !== null) {
    const version = `${page[1]}.${page[2]}`;
    return hasMigrationGuide(version) ? version : undefined;
  }
  const anchor = CHANGELOG_ANCHOR.exec(source);
  return anchor !== null && CHANGELOG_VERSIONS.includes(anchor[1]!) ? anchor[1] : undefined;
}
