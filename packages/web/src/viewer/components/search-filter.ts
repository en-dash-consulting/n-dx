import { h } from "preact";
import { useId } from "preact/hooks";

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
  const inputId = useId();
  return h("div", { role: "search" },
    h("div", { class: "filter-bar" },
      h("label", { class: "sr-only", htmlFor: inputId }, placeholder),
      h("input", {
        id: inputId,
        class: "filter-input",
        type: "search",
        placeholder,
        value,
        onInput: (e: Event) => onInput((e.target as HTMLInputElement).value),
      }),
      ...(filters ?? []).map((f) => {
        const selectId = `${inputId}-${f.value}`;
        return h("div", { key: f.value, class: "filter-select-wrapper" },
          h("label", { class: "sr-only", htmlFor: selectId }, f.label),
          h("select", {
            id: selectId,
            class: "filter-select",
            value: f.value,
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
          ),
        );
      }),
      resultCount != null && totalCount != null
        ? h("span", {
            class: "filter-result-count",
            role: "status",
            "aria-live": "polite",
            "aria-atomic": "true",
          },
            `Showing ${resultCount} of ${totalCount}`
          )
        : null,
    ),
  );
}
