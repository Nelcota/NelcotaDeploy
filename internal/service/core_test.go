package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/nelcota/nelcota-deploy/internal/events"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/nelcota/nelcota-deploy/internal/store"
	"go.uber.org/goleak"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }
func fixture(t *testing.T) (*Core, context.Context, App) {
	t.Helper()
	ctx := WithPrincipal(context.Background(), Principal{ID: "admin", Role: "admin"})
	db, e := store.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = db.Close() })
	v, _ := security.NewVault(make([]byte, 32))
	logs, e := events.NewLogStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	c := &Core{DB: db, Vault: v, Hub: events.NewHub(), LogStore: logs}
	invite, e := (&serversService{c}).Invite(ctx, ServerInput{Name: "test", WireGuardIP: "10.77.0.2"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Write.ExecContext(ctx, "UPDATE servers SET status='online',heartbeat_at=? WHERE id=?", time.Now().Unix(), invite.ServerID)
	if e != nil {
		t.Fatal(e)
	}
	a, e := (&appsService{c}).Create(ctx, AppInput{Name: "app", ServerID: invite.ServerID, Repository: "https://github.com/example/app", Branch: "main"})
	if e != nil {
		t.Fatal(e)
	}
	return c, ctx, a
}
func TestCoalescingAndCapacity(t *testing.T) {
	c, ctx, a := fixture(t)
	s := &deploysService{c}
	d1, e := s.Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("a", 40)})
	if e != nil {
		t.Fatal(e)
	}
	d2, e := s.Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("b", 40)})
	if e != nil {
		t.Fatal(e)
	}
	old, _ := s.Get(ctx, d1.ID)
	if old.Status != "cancelled" {
		t.Fatal(old)
	}
	var wg sync.WaitGroup
	results := make(chan string, 8)
	for range 8 {
		wg.Go(func() {
			d, e := c.Claim(ctx)
			if e == nil {
				results <- d.ID
			}
		})
	}
	wg.Wait()
	close(results)
	var claimed []string
	for id := range results {
		claimed = append(claimed, id)
	}
	if len(claimed) != 1 || claimed[0] != d2.ID {
		t.Fatal(claimed)
	}
}
func TestPermissionsEncryptionAndAudit(t *testing.T) {
	c, ctx, a := fixture(t)
	s := &appsService{c}
	if _, e := s.List(context.Background()); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
	member := WithPrincipal(ctx, Principal{ID: "member", Role: "member"})
	if e := s.SetEnvironment(member, a.ID, nil); !Is(e, Forbidden) {
		t.Fatal(e)
	}
	if e := s.SetEnvironment(ctx, a.ID, []EnvInput{{Key: "TOKEN", Value: "topsecret"}}); e != nil {
		t.Fatal(e)
	}
	var raw []byte
	if e := c.DB.Read.QueryRowContext(ctx, "SELECT encrypted FROM env_vars WHERE app_id=?", a.ID).Scan(&raw); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(raw), "topsecret") {
		t.Fatal("plaintext stored")
	}
	line, e := c.maskApp(ctx, a.ID, "token=topsecret")
	if e != nil || strings.Contains(line, "topsecret") {
		t.Fatal(line, e)
	}
	if _, e := c.DB.Write.ExecContext(ctx, "DELETE FROM audit_log"); e == nil {
		t.Fatal("audit mutable")
	}
}
func TestWebhookSignatureAndDedupe(t *testing.T) {
	c, ctx, a := fixture(t)
	if e := (&settingsService{c}).Set(ctx, "github.webhook_secret", "testsecret"); e != nil {
		t.Fatal(e)
	}
	body := []byte(fmt.Sprintf(`{"ref":"refs/heads/main","after":"%s","repository":{"html_url":"https://github.com/example/app"}}`, strings.Repeat("c", 40)))
	mac := hmac.New(sha256.New, []byte("testsecret"))
	mac.Write(body)
	in := WebhookInput{Signature: "sha256=" + hex.EncodeToString(mac.Sum(nil)), Delivery: "delivery-1", Event: "push", Body: body}
	g := &GitHubService{Core: c}
	for range 2 {
		if e := g.Webhook(ctx, in); e != nil {
			t.Fatal(e)
		}
	}
	d, e := (&deploysService{c}).List(ctx, a.ID)
	if e != nil || len(d) != 1 {
		t.Fatal(d, e)
	}
	in.Signature = "sha256=bad"
	if e = g.Webhook(ctx, in); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
}
func TestInviteAndBootstrapOneUse(t *testing.T) {
	c, ctx, _ := fixture(t)
	auth, e := NewAuth(c, "localhost", "http://localhost:8080")
	if e != nil {
		t.Fatal(e)
	}
	in := UserInput{Email: "admin@example.com", Name: "Admin"}
	enrollment, e := auth.Bootstrap(ctx, in)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = auth.Bootstrap(ctx, in); !Is(e, Conflict) {
		t.Fatal(e)
	}
	if _, e = auth.BeginRegistration(context.Background(), RegistrationInput{EnrollmentToken: enrollment.Token}); e != nil {
		t.Fatal(e)
	}
	if _, e = auth.BeginRegistration(context.Background(), RegistrationInput{}); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
}
func TestTransitions(t *testing.T) {
	for _, v := range [][3]string{{"success", "building", "no"}, {"building", "success", "no"}, {"starting", "success", "yes"}, {"failed", "success", "no"}} {
		if got := validTransition(v[0], v[1]); got != (v[2] == "yes") {
			t.Fatal(v)
		}
	}
}
func BenchmarkQueue(b *testing.B) {
	b.StopTimer()
	ctx := context.Background()
	db, e := store.Open(ctx, filepath.Join(b.TempDir(), "bench.db"))
	if e != nil {
		b.Fatal(e)
	}
	defer db.Close()
	b.StartTimer()
	for b.Loop() {
		_, _ = db.Write.ExecContext(ctx, "INSERT INTO webhook_deliveries(id,received_at) VALUES(?,?)", security.Token(), time.Now().Unix())
	}
}
