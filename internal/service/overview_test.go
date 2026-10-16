package service

import (
	"context"
	"strings"
	"testing"
)

func TestLatestDeploymentsAndScopes(t *testing.T) {
	c, ctx, app := fixture(t)
	s := &deploysService{c}
	first, err := s.Enqueue(ctx, DeployInput{AppID: app.ID, SHA: strings.Repeat("a", 40)})
	if err != nil {
		t.Fatal(err)
	}
	last, err := s.Enqueue(ctx, DeployInput{AppID: app.ID, SHA: strings.Repeat("b", 40)})
	if err != nil {
		t.Fatal(err)
	}
	// Timestamps can tie: insertion order is the deterministic tie breaker.
	if _, err = c.DB.Write.ExecContext(ctx, "UPDATE deployments SET queued_at=100 WHERE id IN (?,?)", first.ID, last.ID); err != nil {
		t.Fatal(err)
	}
	rows, err := s.Latest(ctx)
	if err != nil || len(rows) != 1 || rows[0].ID != last.ID {
		t.Fatalf("latest: %#v %v", rows, err)
	}
	for _, scopes := range [][]string{{"apps:read"}, {"deploys:read"}} {
		restricted := WithPrincipal(context.Background(), Principal{ID: "admin", Role: "admin", Scopes: scopes})
		if _, err = s.Latest(restricted); !Is(err, Forbidden) {
			t.Fatalf("scope bypass: %v", err)
		}
	}
	if _, err = s.Latest(context.Background()); !Is(err, Unauthenticated) {
		t.Fatal(err)
	}
}
