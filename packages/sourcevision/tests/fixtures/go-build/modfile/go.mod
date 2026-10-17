// Fixture: every go.mod construct the reader models.
module github.com/example/app/v2 // trailing comment

go 1.22.0

toolchain go1.22.5

require github.com/single/dep v1.0.0

require (
	github.com/go-chi/chi/v5 v5.0.10
	github.com/lib/pq v1.10.9 // a plain comment
	golang.org/x/sys v0.20.0 // indirect
	"github.com/quoted/dep" v0.1.0
)

require gopkg.in/yaml.v3 v3.0.1 // indirect

replace github.com/lib/pq => ../pq

replace (
	github.com/go-chi/chi/v5 v5.0.10 => github.com/fork/chi/v5 v5.0.11
	golang.org/x/sys => ./third_party/sys
)

exclude github.com/bad/dep v1.2.3

exclude (
	github.com/worse/dep v0.0.1
)

retract v1.0.0
