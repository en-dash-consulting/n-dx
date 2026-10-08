---
"@n-dx/sourcevision": patch
---

Detect Go outbound clients into `outbound.json`.

The fourth and last outbound slice. `analyzers/go-outbound-detection.ts` reports `net/http` (`http.Get`/`Post`/`NewRequest`, and the `client.Do` that issues a request) and `google.golang.org/grpc` (`Dial`, `DialContext`, `NewClient`, and generated `New…Client` stubs) as `kind: "http"` and `"grpc"`; the AWS SDK's SQS and SNS clients across both generations, and `sarama`, as `"queue"`; `go-redis` as `"cache"`; and `database/sql` as `"database"`. `outbound-detection.ts` dispatches `.go` files here, exactly as `server-route-detection.ts` dispatches them to `go-route-detection.ts`, so a mixed-language repository produces one canonically sorted artifact whose consumer never learns which detector found what.

Same record and same two-field rule as the JS/TS slices: a literal address, the `os.Getenv` variable's name, or a struct-field or viper key in `targetSource`, and nothing but reach in `confidence`. An import alias stays `certain` — renaming a package at the import is not indirection at the call site.

No second Go parser: `extractGoImports` resolves which local name each package is bound to, and `stripGoComments` (now exported from `go-route-detection.ts`) removes what must not be matched. That stripper now replaces a block comment with the newlines it spanned rather than a single space, so an offset's line number survives it — without that, every detection after the first multi-line comment named the wrong line.

Two rules came out of probing the detector against this repository's own Go fixtures, where it initially reported both:

- **A method name alone rarely identifies a client.** `r.Header.Get("Authorization")` — a server-side header read — was reported as an outbound HTTP call, because `Get` is in `net/http`'s vocabulary and nothing else in the file contradicted it. Each family now declares which of its methods are strong enough to carry a detection on a receiver the file never binds; for `net/http`, `go-redis` and `database/sql` that set is empty, because `Get`, `Set`, `Do`, `Query` and `Exec` are method names on everything. A bound receiver is unambiguous and still reports.
- **A positional target is read from its position only.** `sql.Open("postgres", dsn)` with `dsn` a parameter reported `"postgres"` — the driver name — as the address of the database, because an unresolved target fell back to scanning the other arguments for a literal. An unresolved target is now `unknown`; it is never the next literal in the call.
