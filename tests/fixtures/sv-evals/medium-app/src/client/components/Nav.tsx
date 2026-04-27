import * as React from "react";
import { Button } from "./Button.js";

export interface NavProps {
  onNavigate: (page: "home" | "user") => void;
}

export function Nav({ onNavigate }: NavProps): React.ReactElement {
  return (
    <nav>
      <Button label="Home" onClick={() => onNavigate("home")} />
      <Button label="Profile" onClick={() => onNavigate("user")} />
    </nav>
  );
}
