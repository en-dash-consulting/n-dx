import * as React from "react";

export interface CardProps {
  title: string;
  children: React.ReactNode;
}

export function Card({ title, children }: CardProps): React.ReactElement {
  return (
    <section>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
