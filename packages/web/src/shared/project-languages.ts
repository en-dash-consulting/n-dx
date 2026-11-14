/**
 * The project languages the dashboard offers for the top-level `language`
 * setting, with the label Settings › Project shows for each.
 *
 * A mirror of `VALID_LANGUAGE_IDS` in `@n-dx/lang-kit`: `shared/` is bundled
 * for the browser and imports no package. `tests/unit/config-language-parity.test.js`
 * holds this list to lang-kit's, as it holds `ndx config`'s, so a language
 * added there fails a test until it is offered here too.
 *
 * Two consumers: the project-settings route validates against it, and the
 * Project page builds its select from it.
 */

export interface ProjectLanguage {
  /** The value stored as `language`; "auto" stands for no override. */
  id: string;
  label: string;
}

export const PROJECT_LANGUAGES: readonly ProjectLanguage[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "python", label: "Python" },
  { id: "csharp", label: "C#" },
  { id: "java", label: "Java" },
  { id: "php", label: "PHP" },
];

/** True when `id` is a language the setting accepts. */
export function isProjectLanguage(id: string): boolean {
  return PROJECT_LANGUAGES.some((language) => language.id === id);
}
