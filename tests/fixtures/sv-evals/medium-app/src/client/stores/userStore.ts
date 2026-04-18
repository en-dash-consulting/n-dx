import type { User } from "../../shared/types.js";

interface UserStoreState {
  users: User[];
  updateName: (id: string, name: string) => void;
}

let state: UserStoreState = {
  users: [],
  updateName: (id, name) => {
    state.users = state.users.map((u) => (u.id === id ? { ...u, name } : u));
  },
};

export function useUserStore<T>(selector: (s: UserStoreState) => T): T {
  return selector(state);
}
