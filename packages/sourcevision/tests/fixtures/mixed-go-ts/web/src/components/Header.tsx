import { formatTitle } from "../utils/format.js";

export function Header({ title }: { title: string }) {
  return <h1>{formatTitle(title)}</h1>;
}
