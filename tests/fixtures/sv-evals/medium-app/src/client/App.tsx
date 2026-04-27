import * as React from "react";
import { Nav } from "./components/Nav.js";
import { HomePage } from "./pages/HomePage.js";
import { UserPage } from "./pages/UserPage.js";

export function App(): React.ReactElement {
  const [page, setPage] = React.useState<"home" | "user">("home");
  return (
    <div>
      <Nav onNavigate={setPage} />
      {page === "home" ? <HomePage /> : <UserPage />}
    </div>
  );
}
