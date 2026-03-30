package response_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	. "github.com/example/go-project/pkg/response"
)

func TestJSON_WritesContentType(t *testing.T) {
	w := httptest.NewRecorder()
	JSON(w, http.StatusOK, map[string]string{"ok": "true"})

	ct := w.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Errorf("expected application/json content type, got %s", ct)
	}
}

func TestError_WritesErrorBody(t *testing.T) {
	w := httptest.NewRecorder()
	Error(w, http.StatusBadRequest, "bad input")

	body := w.Body.String()
	if !strings.Contains(body, "bad input") {
		t.Errorf("expected error message in body, got %s", body)
	}
}
