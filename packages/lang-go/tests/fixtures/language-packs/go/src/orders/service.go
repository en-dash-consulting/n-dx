package orders

import (
	"encoding/json"
	"fmt"
	. "math"
	_ "embed"
	httpx "net/http"
)

import "os"

import `strings`

// Status is a defined type, which the types query does not capture.
type Status int

type Order struct {
	ID     int64  `json:"id" db:"order_id"`
	Status string `json:"status,omitempty"`
	Note   string "legacy:\"tag\""
	Width, Height int `json:"size"`
	Audit
	untagged bool
}

type Repository interface {
	Find(id int64) (*Order, error)
}

type Alias = Order

type Page[T any] struct {
	Items []T `json:"items"`
}

type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

func Map[T, U any](in []T, f func(T) U) []U {
	out := make([]U, 0, len(in))
	for _, v := range in {
		out = append(out, f(v))
	}
	return out
}

func (s *Service) Open(w httpx.ResponseWriter, r *httpx.Request) {
	fmt.Fprintln(w, s.repo.Find(1))
	json.NewEncoder(w).Encode(map[string]string{"state": "open"})
	_ = os.Getenv("ORDERS_MODE")
	_ = strings.ToUpper(`raw`)
	fmt.Println(Sqrt(2), fmt.Sprint("nested", Abs(-1)))
}

func (o Order) Total() int64 {
	return o.ID
}

func (p *Page[T]) Len() int {
	return len(p.Items)
}

func (Page[T]) Kind() string { return "page" }
