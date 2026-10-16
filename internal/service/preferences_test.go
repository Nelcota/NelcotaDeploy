package service

import "testing"

func TestHideFirstStepsIsPerPerson(t *testing.T) {
	c, ctx, _ := fixture(t)
	a := &AuthService{Core: c}
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES('admin','admin@example.com','Admin','admin',0),('other','other@example.com','Other','admin',0)"); e != nil {
		t.Fatal(e)
	}
	other := WithPrincipal(ctx, Principal{ID: "other", Role: "admin"})
	if p, e := a.Preferences(ctx); e != nil || p.FirstStepsHidden {
		t.Fatal(p, e)
	}
	if e := a.HideFirstSteps(WithPrincipal(ctx, Principal{ID: "admin", Role: "admin", Scopes: []string{"apps:write"}})); !Is(e, Forbidden) {
		t.Fatal("a token changed a preference", e)
	}
	if e := a.HideFirstSteps(ctx); e != nil {
		t.Fatal(e)
	}
	if p, e := a.Preferences(ctx); e != nil || !p.FirstStepsHidden {
		t.Fatal(p, e)
	}
	if p, e := a.Preferences(other); e != nil || p.FirstStepsHidden {
		t.Fatal("hiding affected another person", p, e)
	}
}
