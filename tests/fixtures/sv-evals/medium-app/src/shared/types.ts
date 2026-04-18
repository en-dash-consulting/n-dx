export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Post {
  id: string;
  title: string;
  body: string;
  authorId: string;
  createdAt: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
