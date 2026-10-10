import { createContext, useContext, useState } from "react";
import type { Scheme } from "@graview/primitives";

/** The scheme the shell toggles, handed down from main.tsx so both faces agree. */
export const SchemeContext = createContext<{ initial: Scheme; apply: (scheme: Scheme) => void }>({ initial: "light", apply: () => {} });

export function useScheme(): [Scheme, () => void] {
  const { initial, apply } = useContext(SchemeContext);
  const [scheme, setScheme] = useState<Scheme>(initial);
  return [
    scheme,
    () => {
      const next: Scheme = scheme === "dark" ? "light" : "dark";
      setScheme(next);
      apply(next);
    },
  ];
}
