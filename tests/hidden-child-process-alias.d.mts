/**
 * Types for the vitest alias entries, so a package's `vitest.config.ts` can
 * import them under `--noEmit` without an implicit `any`.
 *
 * @see tests/hidden-child-process-alias.mjs
 */
export declare const hiddenChildProcessAlias: Array<{
  find: RegExp;
  replacement: string;
}>;
