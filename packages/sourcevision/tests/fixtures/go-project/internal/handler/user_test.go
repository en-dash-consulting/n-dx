package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUserHandler_List(t *testing.T) {
	h := NewUserHandler()
	req := httptest.NewRequest(http.MethodGet, "/users", nil)
	w := httptest.NewRecorder()

	h.List(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}
