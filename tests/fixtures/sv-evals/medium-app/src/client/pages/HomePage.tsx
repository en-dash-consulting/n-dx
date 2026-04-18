import * as React from "react";
import { Card } from "../components/Card.js";
import { usePostStore } from "../stores/postStore.js";

export function HomePage(): React.ReactElement {
  const posts = usePostStore((s) => s.posts);
  return (
    <div>
      <h1>Home</h1>
      {posts.map((p) => (
        <Card key={p.id} title={p.title}>
          {p.body}
        </Card>
      ))}
    </div>
  );
}
