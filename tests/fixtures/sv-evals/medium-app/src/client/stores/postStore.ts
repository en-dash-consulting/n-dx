import type { Post } from "../../shared/types.js";

interface PostStoreState {
  posts: Post[];
  addPost: (post: Post) => void;
}

let state: PostStoreState = {
  posts: [],
  addPost: (post) => {
    state.posts = [...state.posts, post];
  },
};

export function usePostStore<T>(selector: (s: PostStoreState) => T): T {
  return selector(state);
}
