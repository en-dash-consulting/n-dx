import * as React from "react";
import { Card } from "../components/Card.js";
import { Input } from "../components/Input.js";
import { Button } from "../components/Button.js";
import { useAuth } from "../hooks/useAuth.js";
import { useUserStore } from "../stores/userStore.js";

export function UserPage(): React.ReactElement {
  const { user } = useAuth();
  const update = useUserStore((s) => s.updateName);
  const [name, setName] = React.useState(user?.name ?? "");
  return (
    <Card title="Profile">
      <Input value={name} onChange={setName} />
      <Button label="Save" onClick={() => user && update(user.id, name)} />
    </Card>
  );
}
