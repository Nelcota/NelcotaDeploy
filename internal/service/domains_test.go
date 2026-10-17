package service

import (
	"context"
	"errors"
	"testing"
)

func TestCheckDomains(t *testing.T) {
	c, ctx, a := fixture(t)
	s := &appsService{c}
	a.Config.Domains = []string{"ok.example.com", "missing.example.com"}
	if _, e := s.Update(ctx, a.ID, AppInput{a.Name, a.ServerID, a.Repository, a.Branch, a.Config}); e != nil {
		t.Fatal(e)
	}
	old := lookupHost
	defer func() { lookupHost = old }()
	lookupHost = func(_ context.Context, host string) ([]string, error) {
		if host == "ok.example.com" {
			return []string{"203.0.113.9", "2001:db8::1"}, nil
		}
		return nil, errors.New("no such host")
	}
	got, e := s.CheckDomains(ctx, a.ID)
	if e != nil || len(got) != 2 || !got[0].Resolves || got[0].Addresses[0] != "2001:db8::1" || got[1].Resolves {
		t.Fatal(got, e)
	}
	if _, e := s.CheckDomains(WithPrincipal(ctx, Principal{}), a.ID); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
}
