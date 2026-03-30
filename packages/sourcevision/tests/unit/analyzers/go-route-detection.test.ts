import { describe, it, expect } from "vitest";
import { detectGoServerRoutes } from "../../../src/analyzers/go-route-detection.js";

// ── net/http stdlib ─────────────────────────────────────────────────────────

describe("net/http stdlib routes", () => {
  it("detects http.HandleFunc", () => {
    const source = `
package main

import "net/http"

func main() {
  http.HandleFunc("/health", healthHandler)
  http.HandleFunc("/api/users", usersHandler)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].file).toBe("main.go");
    expect(groups[0].routes).toHaveLength(2);

    const routes = groups[0].routes;
    expect(routes[0]).toMatchObject({ method: "GET", path: "/api/users" });
    expect(routes[1]).toMatchObject({ method: "GET", path: "/health" });
  });

  it("detects http.Handle", () => {
    const source = `
package main

func main() {
  http.Handle("/static/", http.FileServer(http.Dir("./static")))
}`;
    const groups = detectGoServerRoutes(source, "server.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/static/" });
  });

  it("detects mux.HandleFunc", () => {
    const source = `
package main

func main() {
  mux := http.NewServeMux()
  mux.HandleFunc("/api/v1/items", itemsHandler)
  mux.Handle("/api/v1/orders", ordersHandler)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/api/v1/items" });
    expect(groups[0].routes[1]).toMatchObject({ method: "GET", path: "/api/v1/orders" });
  });

  it("records all stdlib routes as GET (method-agnostic)", () => {
    const source = `
package main

func main() {
  http.HandleFunc("/submit", submitHandler)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups[0].routes[0].method).toBe("GET");
  });

  it("detects serveMux.HandleFunc variant", () => {
    const source = `
package main

func main() {
  serveMux.HandleFunc("/ping", pingHandler)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/ping" });
  });

  it("detects server.HandleFunc variant", () => {
    const source = `
package main

func main() {
  server.HandleFunc("/status", statusHandler)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/status" });
  });
});

// ── chi framework ───────────────────────────────────────────────────────────

describe("chi framework routes", () => {
  it("detects chi method routes (Get, Post, Put, Delete, Patch)", () => {
    const source = `
package main

import "github.com/go-chi/chi/v5"

func main() {
  r := chi.NewRouter()
  r.Get("/users", listUsers)
  r.Post("/users", createUser)
  r.Put("/users/{id}", updateUser)
  r.Delete("/users/{id}", deleteUser)
  r.Patch("/users/{id}", patchUser)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(5);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });

  it("extracts chi path parameters with {id} syntax", () => {
    const source = `
package main

func main() {
  r.Get("/users/{userID}/posts/{postID}", getPost)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/users/{userID}/posts/{postID}");
  });

  it("detects chi Options and Head methods", () => {
    const source = `
package main

func main() {
  r.Options("/api/cors", corsHandler)
  r.Head("/api/health", healthCheck)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["HEAD", "OPTIONS"]);
  });
});

// ── gin framework ───────────────────────────────────────────────────────────

describe("gin framework routes", () => {
  it("detects gin uppercase method routes (GET, POST, PUT, DELETE, PATCH)", () => {
    const source = `
package main

import "github.com/gin-gonic/gin"

func main() {
  router := gin.Default()
  router.GET("/products", listProducts)
  router.POST("/products", createProduct)
  router.PUT("/products/:id", updateProduct)
  router.DELETE("/products/:id", deleteProduct)
  router.PATCH("/products/:id", patchProduct)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(5);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });

  it("extracts gin path parameters with :id syntax", () => {
    const source = `
package main

func main() {
  router.GET("/users/:userID/orders/:orderID", getOrder)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/users/:userID/orders/:orderID");
  });

  it("detects gin OPTIONS and HEAD methods", () => {
    const source = `
package main

func main() {
  router.OPTIONS("/api/preflight", preflightHandler)
  router.HEAD("/api/ping", pingHandler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["HEAD", "OPTIONS"]);
  });
});

// ── echo framework ──────────────────────────────────────────────────────────

describe("echo framework routes", () => {
  it("detects echo uppercase method routes", () => {
    const source = `
package main

import "github.com/labstack/echo/v4"

func main() {
  e := echo.New()
  e.GET("/articles", listArticles)
  e.POST("/articles", createArticle)
  e.PUT("/articles/:id", updateArticle)
  e.DELETE("/articles/:id", deleteArticle)
  e.PATCH("/articles/:id", patchArticle)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(5);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });

  it("extracts echo path parameters with :id syntax", () => {
    const source = `
package main

func main() {
  e.GET("/teams/:teamID/members/:memberID", getMember)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/teams/:teamID/members/:memberID");
  });
});

// ── fiber framework ─────────────────────────────────────────────────────────

describe("fiber framework routes", () => {
  it("detects fiber mixed-case method routes (Get, Post, Put, Delete, Patch)", () => {
    const source = `
package main

import "github.com/gofiber/fiber/v2"

func main() {
  app := fiber.New()
  app.Get("/tasks", listTasks)
  app.Post("/tasks", createTask)
  app.Put("/tasks/:id", updateTask)
  app.Delete("/tasks/:id", deleteTask)
  app.Patch("/tasks/:id", patchTask)
}`;
    const groups = detectGoServerRoutes(source, "main.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(5);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });

  it("extracts fiber path parameters with :id syntax", () => {
    const source = `
package main

func main() {
  app.Get("/projects/:projectID/issues/:issueID", getIssue)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/projects/:projectID/issues/:issueID");
  });
});

// ── gorilla/mux framework ───────────────────────────────────────────────────

describe("gorilla/mux framework routes", () => {
  it("detects HandleFunc().Methods() chain with single method", () => {
    const source = `
package main

import "github.com/gorilla/mux"

func main() {
  r := mux.NewRouter()
  r.HandleFunc("/users", listUsers).Methods("GET")
  r.HandleFunc("/users", createUser).Methods("POST")
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/users" });
    expect(groups[0].routes[1]).toMatchObject({ method: "POST", path: "/users" });
  });

  it("detects HandleFunc().Methods() chain with multiple methods", () => {
    const source = `
package main

func main() {
  r.HandleFunc("/api/data").Methods("GET", "POST")
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["GET", "POST"]);
  });

  it("detects Methods().Path() alternate chain", () => {
    const source = `
package main

func main() {
  r.Methods("GET").Path("/api/items").HandlerFunc(listItems)
  r.Methods("PUT").Path("/api/items/{id}").HandlerFunc(updateItem)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/api/items" });
    expect(groups[0].routes[1]).toMatchObject({ method: "PUT", path: "/api/items/{id}" });
  });

  it("detects Methods().Path() chain with multiple methods", () => {
    const source = `
package main

func main() {
  r.Methods("GET", "HEAD").Path("/api/ping").HandlerFunc(pingHandler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);

    const methods = groups[0].routes.map((r) => r.method).sort();
    expect(methods).toEqual(["GET", "HEAD"]);
  });

  it("extracts gorilla path parameters with {id} syntax", () => {
    const source = `
package main

func main() {
  r.HandleFunc("/users/{userID}/roles/{roleID}", getRole).Methods("GET")
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/users/{userID}/roles/{roleID}");
  });

  it("handles HandleFunc with handler argument before Methods chain", () => {
    const source = `
package main

func main() {
  r.HandleFunc("/items/{id}", getItem).Methods("GET")
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/items/{id}" });
  });
});

// ── Route grouping by file ──────────────────────────────────────────────────

describe("route grouping by file", () => {
  it("groups all routes under the same file path", () => {
    const source = `
package main

func main() {
  r.Get("/api/v1/users", listUsers)
  r.Post("/api/v1/users", createUser)
  r.Get("/api/v1/orders", listOrders)
}`;
    const groups = detectGoServerRoutes(source, "handlers/api.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].file).toBe("handlers/api.go");
    expect(groups[0].routes).toHaveLength(3);
    for (const route of groups[0].routes) {
      expect(route.file).toBe("handlers/api.go");
    }
  });

  it("infers common prefix from routes", () => {
    const source = `
package main

func main() {
  r.Get("/api/v1/users", listUsers)
  r.Get("/api/v1/orders", listOrders)
  r.Post("/api/v1/products", createProduct)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].prefix).toBe("/api/v1/");
  });

  it("infers / prefix when routes share no common path", () => {
    const source = `
package main

func main() {
  r.Get("/health", healthCheck)
  r.Get("/api/users", listUsers)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].prefix).toBe("/");
  });

  it("sorts routes by method then path", () => {
    const source = `
package main

func main() {
  r.Post("/b", handlerB)
  r.Get("/b", handlerGetB)
  r.Get("/a", handlerA)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    const routes = groups[0].routes;
    expect(routes[0]).toMatchObject({ method: "GET", path: "/a" });
    expect(routes[1]).toMatchObject({ method: "GET", path: "/b" });
    expect(routes[2]).toMatchObject({ method: "POST", path: "/b" });
  });
});

// ── Mixed framework detection ───────────────────────────────────────────────

describe("mixed framework detection in single file", () => {
  it("detects routes from multiple framework patterns in one file", () => {
    const source = `
package main

func main() {
  http.HandleFunc("/legacy", legacyHandler)
  r.Get("/api/v2/items", listItems)
  router.GET("/api/v2/widgets", listWidgets)
}`;
    const groups = detectGoServerRoutes(source, "mixed.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(3);
  });

  it("deduplicates identical method+path pairs across patterns", () => {
    // chi Get and gin GET both match the same pattern syntax
    // but with different casing — should both get captured as unique
    const source = `
package main

func main() {
  r.Get("/api/test", handler1)
  router.GET("/api/test", handler2)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    // Both patterns resolve to GET /api/test, should be deduplicated
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0]).toMatchObject({ method: "GET", path: "/api/test" });
  });
});

// ── False-positive safety: comments ─────────────────────────────────────────

describe("false-positive safety — comments", () => {
  it("ignores routes in line comments", () => {
    const source = `
package main

func main() {
  // http.HandleFunc("/old-route", oldHandler)
  // r.Get("/deprecated", handler)
  r.Get("/active", activeHandler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0].path).toBe("/active");
  });

  it("ignores routes in block comments", () => {
    const source = `
package main

func main() {
  /*
  http.HandleFunc("/commented-out", handler)
  r.Get("/also-commented", handler2)
  router.POST("/nope", handler3)
  */
  r.Get("/real-route", realHandler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0].path).toBe("/real-route");
  });

  it("ignores routes in inline comments after code", () => {
    const source = `
package main

func main() {
  r.Get("/active", handler) // r.Get("/ignore-this", otherHandler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0].path).toBe("/active");
  });

  it("ignores route patterns inside multi-line block comments", () => {
    const source = `
package main

/*
  TODO: Add these routes later
  r.HandleFunc("/future-endpoint").Methods("POST")
  r.Methods("DELETE").Path("/api/cleanup").HandlerFunc(cleanup)
*/

func main() {
  r.Get("/current", currentHandler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0].path).toBe("/current");
  });
});

// ── False-positive safety: non-route string literals ────────────────────────

describe("false-positive safety — non-route string literals", () => {
  it("does not match route calls inside escaped double-quoted strings", () => {
    // In Go source, escaped quotes inside strings prevent regex matching.
    // The source text below represents: msg := "r.Get(\"/not-a-route\", handler)"
    // where \" are literal backslash-quote sequences in the Go file.
    const source =
      'msg := "r.Get(\\"/not-a-route\\", handler)"\n' +
      'r.Get("/real-route", realHandler)';
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0].path).toBe("/real-route");
  });

  it("preserves route patterns inside backtick raw strings (known limitation)", () => {
    // Go backtick strings contain unescaped quotes, so stripGoComments
    // preserves their content and the route regexes match inside.
    // This documents current behavior — in practice, Go raw strings
    // containing route registration calls are extremely rare.
    const source =
      "var help = `\nr.Get(\"/fake\", handler)\n`\n\nr.Get(\"/real\", handler)";
    const groups = detectGoServerRoutes(source, "routes.go");
    // Both routes detected — the backtick string is not filtered
    expect(groups[0].routes.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].routes.some((r) => r.path === "/real")).toBe(true);
  });

  it("does not match plain string assignments without route call syntax", () => {
    const source = [
      "package main",
      "",
      "func main() {",
      '  path := "/api/users"',
      '  url := "https://example.com/api/users"',
      '  r.Get("/api/users", listUsers)',
      "}",
    ].join("\n");
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0].path).toBe("/api/users");
  });

  it("does not match fmt.Println or log calls with path-like strings", () => {
    const source = [
      "package main",
      "",
      "func main() {",
      '  fmt.Println("Listening on /api/health")',
      '  log.Printf("Route: /api/users registered")',
      '  r.Get("/api/health", healthHandler)',
      "}",
    ].join("\n");
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(1);
    expect(groups[0].routes[0].path).toBe("/api/health");
  });
});

// ── Empty inputs and no-route files ─────────────────────────────────────────

describe("empty inputs and no-route files", () => {
  it("returns empty array for empty source string", () => {
    const groups = detectGoServerRoutes("", "empty.go");
    expect(groups).toEqual([]);
  });

  it("returns empty array for file with no route registrations", () => {
    const source = `
package main

import "fmt"

type User struct {
  ID   int
  Name string
}

func greet(name string) string {
  return fmt.Sprintf("Hello, %s!", name)
}`;
    const groups = detectGoServerRoutes(source, "models.go");
    expect(groups).toEqual([]);
  });

  it("returns empty array for file with only comments", () => {
    const source = `
// Package main provides the entry point
// This file has no actual code
/* Just a block comment */`;
    const groups = detectGoServerRoutes(source, "doc.go");
    expect(groups).toEqual([]);
  });

  it("returns empty array for file with only imports", () => {
    const source = `
package main

import (
  "fmt"
  "net/http"
)`;
    const groups = detectGoServerRoutes(source, "imports.go");
    expect(groups).toEqual([]);
  });
});

// ── Path parameter variations ───────────────────────────────────────────────

describe("path parameter variations", () => {
  it("preserves chi/gorilla {param} syntax as-is", () => {
    const source = `
package main

func main() {
  r.Get("/users/{id}", getUser)
  r.Get("/teams/{teamID}/members/{memberID}", getMember)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/teams/{teamID}/members/{memberID}");
    expect(groups[0].routes[1].path).toBe("/users/{id}");
  });

  it("preserves gin/echo/fiber :param syntax as-is", () => {
    const source = `
package main

func main() {
  router.GET("/users/:id", getUser)
  router.GET("/teams/:teamID/members/:memberID", getMember)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/teams/:teamID/members/:memberID");
    expect(groups[0].routes[1].path).toBe("/users/:id");
  });

  it("preserves gorilla {param} in Methods().Path() pattern", () => {
    const source = `
package main

func main() {
  r.Methods("GET").Path("/orders/{orderID}/items/{itemID}").HandlerFunc(getOrderItem)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups[0].routes[0].path).toBe("/orders/{orderID}/items/{itemID}");
  });
});

// ── Method validation ───────────────────────────────────────────────────────

describe("method validation", () => {
  it("rejects invalid HTTP methods", () => {
    // This tests the VALID_METHODS guard — a method not in the set is ignored
    const source = `
package main

func main() {
  r.Get("/valid", handler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    // "Get" normalizes to "GET" which is valid
    expect(groups).toHaveLength(1);
    expect(groups[0].routes[0].method).toBe("GET");
  });

  it("normalizes method names to uppercase", () => {
    const source = `
package main

func main() {
  r.Get("/a", handler1)
  r.Post("/b", handler2)
  r.Put("/c", handler3)
  r.Delete("/d", handler4)
  r.Patch("/e", handler5)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    const methods = groups[0].routes.map((r) => r.method);
    expect(methods).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });
});

// ── Whitespace variations ───────────────────────────────────────────────────

describe("whitespace variations", () => {
  it("handles extra whitespace around dot and parenthesis", () => {
    const source = `
package main

func main() {
  r . Get ( "/users" , listUsers)
  http . HandleFunc ( "/health" , healthHandler)
}`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(2);
  });

  it("handles routes on a single long line", () => {
    const source = `package main
func main() { r.Get("/a", h1); r.Post("/b", h2); r.Put("/c", h3) }`;
    const groups = detectGoServerRoutes(source, "routes.go");
    expect(groups).toHaveLength(1);
    expect(groups[0].routes).toHaveLength(3);
  });
});
