import { createContext } from "react";
import type { Scheme } from "@graview/primitives";

/** The scheme the shell toggles, handed down from main.tsx so both faces agree. */
export const SchemeContext = createContext<{ initial: Scheme; apply: (scheme: Scheme) => void }>({ initial: "light", apply: () => {} });
