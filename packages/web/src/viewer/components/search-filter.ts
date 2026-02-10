import { h } from "preact";

interface FilterOption {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
}

interface SearchFilterProps {
  placeholder?: string;
  value: string;
  onInput: (value: string) => void;
  resultCount?: number;
  totalCount?: number;
  filters?: FilterOption[];
}

export function SearchFilter({
  placeholder = "Search...",
  value,
  onInput,
  resultCount,
  totalCount,
  filters,
}: SearchFilterProps) {
  return h("div", { role: "search" },
    h("div", { class: "filter-bar" },
      h("input", {
        class: "filter-input",
        type: "search",
        placeholder,
        value,
        "aria-label": placeholder,
        onInput: (e: Event) => onInput((e.target as HTMLInputElement).value),
      }),
      ...(filters ?? []).map((f) =>
        h("select", {
          key: f.value,
          class: "filter-select",
          value: f.value,
          "aria-label": f.label,
          onChange: (e: Event) => {
            const opt = f.options.find(
              (o) => o.value === (e.target as HTMLSelectElement).value
            );
            if (opt) {
              (e.target as HTMLSelectElement).dispatchEvent(
                new CustomEvent("filter-change", { detail: opt.value })
              );
            }
          },
        },
          f.options.map((o) =>
            h("option", { key: o.value, value: o.value }, o.label)
          )
        )
      ),
      resultCount != null && totalCount != null
        ? h("span", {
            class: "filter-result-count",
            "aria-live": "polite",
          },
            `Showing ${resultCount} of ${totalCount}`
          )
        : null,
    ),
  );
}
