package security

import (
	"crypto/ed25519"
	"crypto/rand"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"testing"
	"time"
)

func TestVault(t *testing.T) {
	v, e := NewVault(make([]byte, 32))
	if e != nil {
		t.Fatal(e)
	}
	c, e := v.Seal([]byte("secret"), "app:KEY")
	if e != nil {
		t.Fatal(e)
	}
	p, e := v.Open(c, "app:KEY")
	if e != nil || string(p) != "secret" {
		t.Fatal(e)
	}
	if _, e = v.Open(c, "other:KEY"); e == nil {
		t.Fatal("AAD substitution accepted")
	}
	c[len(c)-1] ^= 1
	if _, e = v.Open(c, "app:KEY"); e == nil {
		t.Fatal("tamper accepted")
	}
}
func TestCommandSignature(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now()
	c := &agentv1.Command{Id: Token(), ServerId: "server", IssuedUnix: now.Unix(), ExpiresUnix: now.Add(30 * time.Second).Unix(), Action: &agentv1.Command_Stats{Stats: &agentv1.Stats{}}}
	if e := Sign(c, key); e != nil {
		t.Fatal(e)
	}
	v := &Verifier{Key: pub, ServerID: "server"}
	if e := v.Verify(c, now); e != nil {
		t.Fatal(e)
	}
	if e := v.Verify(c, now); e == nil {
		t.Fatal("replay accepted")
	}
	c.ServerId = "other"
	if e := v.Verify(c, now); e == nil {
		t.Fatal("cross server command")
	}
}
func TestPKI(t *testing.T) {
	ca, e := NewAuthority(time.Now())
	if e != nil {
		t.Fatal(e)
	}
	c, k, e := ca.Issue("server", false, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	root, _, _ := ca.PEM()
	if _, e = TLSConfig(c, k, root, false); e != nil {
		t.Fatal(e)
	}
}
func BenchmarkVault(b *testing.B) {
	v, _ := NewVault(make([]byte, 32))
	for b.Loop() {
		_, _ = v.Seal([]byte("environment value"), "app:key")
	}
}

func TestSplitSecretsMasked(t *testing.T) {
	var out []byte
	m := NewLineMasker(NewRedactor([]string{"very-secret-token"}), func(b []byte) { out = append(out, b...) })
	_, _ = m.Write([]byte("token=very-sec"))
	_, _ = m.Write([]byte("ret-token\n"))
	m.Flush()
	if string(out) != "token=[REDACTED]\n" {
		t.Fatal(string(out))
	}
}

func TestReplaySurvivesRestart(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now()
	c := &agentv1.Command{Id: Token(), ServerId: "s", IssuedUnix: now.Unix(), ExpiresUnix: now.Unix() + 30, Action: &agentv1.Command_Stats{Stats: &agentv1.Stats{}}}
	if e := Sign(c, key); e != nil {
		t.Fatal(e)
	}
	path := t.TempDir() + "/replay.json"
	v := &Verifier{Key: pub, ServerID: "s", Path: path}
	if e := v.Verify(c, now); e != nil {
		t.Fatal(e)
	}
	restarted := &Verifier{Key: pub, ServerID: "s", Path: path}
	if e := restarted.Verify(c, now); e == nil {
		t.Fatal("persisted replay accepted")
	}
}
