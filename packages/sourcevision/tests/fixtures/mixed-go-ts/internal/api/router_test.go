package api

import "testing"

func TestNewRouter(t *testing.T) {
	r := NewRouter()
	if r == nil {
		t.Fatal("expected non-nil router")
	}
}
