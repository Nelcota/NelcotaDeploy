package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"github.com/pquerna/otp/totp"
	"net/url"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"
)

type virtualKey struct {
	key     *ecdsa.PrivateKey
	id      []byte
	user    string
	counter uint32
}

func challenge(t *testing.T, c Ceremony) string {
	t.Helper()
	var v struct {
		PublicKey struct {
			Challenge string `json:"challenge"`
		} `json:"publicKey"`
	}
	if e := json.Unmarshal(c.Options, &v); e != nil {
		t.Fatal(e)
	}
	if v.PublicKey.Challenge == "" {
		t.Fatal(string(c.Options))
	}
	return v.PublicKey.Challenge
}
func encoded(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
func newVirtualKey(t *testing.T, user string) *virtualKey {
	t.Helper()
	k, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	id := make([]byte, 32)
	rand.Read(id)
	return &virtualKey{k, id, user, 1}
}
func (k *virtualKey) registration(t *testing.T, c Ceremony) json.RawMessage {
	t.Helper()
	client, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": challenge(t, c), "origin": "http://localhost:8080"})
	rp := sha256.Sum256([]byte("localhost"))
	auth := append([]byte{}, rp[:]...)
	auth = append(auth, 0x45)
	auth = binary.BigEndian.AppendUint32(auth, k.counter)
	auth = append(auth, make([]byte, 16)...)
	auth = binary.BigEndian.AppendUint16(auth, uint16(len(k.id)))
	auth = append(auth, k.id...)
	cose, e := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: k.key.X.FillBytes(make([]byte, 32)), -3: k.key.Y.FillBytes(make([]byte, 32))})
	if e != nil {
		t.Fatal(e)
	}
	auth = append(auth, cose...)
	att, e := cbor.Marshal(map[string]any{"fmt": "none", "authData": auth, "attStmt": map[string]any{}})
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(map[string]any{"id": encoded(k.id), "rawId": encoded(k.id), "type": "public-key", "response": map[string]any{"clientDataJSON": encoded(client), "attestationObject": encoded(att), "transports": []string{"internal"}}, "clientExtensionResults": map[string]any{}})
	return b
}
func (k *virtualKey) assertion(t *testing.T, c Ceremony) json.RawMessage {
	t.Helper()
	k.counter++
	client, _ := json.Marshal(map[string]any{"type": "webauthn.get", "challenge": challenge(t, c), "origin": "http://localhost:8080"})
	rp := sha256.Sum256([]byte("localhost"))
	auth := append([]byte{}, rp[:]...)
	auth = append(auth, 0x05)
	auth = binary.BigEndian.AppendUint32(auth, k.counter)
	clientHash := sha256.Sum256(client)
	digest := sha256.Sum256(append(append([]byte{}, auth...), clientHash[:]...))
	signature, e := ecdsa.SignASN1(rand.Reader, k.key, digest[:])
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(map[string]any{"id": encoded(k.id), "rawId": encoded(k.id), "type": "public-key", "response": map[string]any{"clientDataJSON": encoded(client), "authenticatorData": encoded(auth), "signature": encoded(signature), "userHandle": encoded([]byte(k.user))}, "clientExtensionResults": map[string]any{}})
	return b
}
func TestWebAuthnVirtualAuthenticator(t *testing.T) {
	core, ctx, _ := fixture(t)
	auth, e := NewAuth(core, "localhost", "http://localhost:8080")
	if e != nil {
		t.Fatal(e)
	}
	en, e := auth.Bootstrap(ctx, UserInput{Email: "webauthn@example.com", Name: "Virtual authenticator"})
	if e != nil {
		t.Fatal(e)
	}
	key := newVirtualKey(t, en.UserID)
	ceremony, e := auth.BeginRegistration(context.Background(), RegistrationInput{EnrollmentToken: en.Token})
	if e != nil {
		t.Fatal(e)
	}
	finish := FinishInput{ceremony.ID, key.registration(t, ceremony)}
	if e = auth.FinishRegistration(context.Background(), finish); e != nil {
		t.Fatal(e)
	}
	if e = auth.FinishRegistration(context.Background(), finish); !Is(e, Unauthenticated) {
		t.Fatal("challenge replay", e)
	}
	if _, e = auth.BeginRegistration(context.Background(), RegistrationInput{EnrollmentToken: en.Token}); !Is(e, Unauthenticated) {
		t.Fatal("enrollment replay", e)
	}
	login, e := auth.BeginLogin(ctx, "webauthn@example.com")
	if e != nil {
		t.Fatal(e)
	}
	assertion := key.assertion(t, login)
	loginCtx := WithPrincipal(context.Background(), Principal{IP: "192.0.2.10"})
	result, e := auth.FinishLogin(loginCtx, FinishInput{login.ID, assertion})
	if e != nil || result.Token == "" {
		t.Fatal(result, e)
	}
	var auditIP string
	if e := core.DB.Read.QueryRowContext(ctx, "SELECT ip FROM audit_log WHERE action='auth.login' AND user_id=?", en.UserID).Scan(&auditIP); e != nil || auditIP != "192.0.2.10" {
		t.Fatal("login audit IP missing", e)
	}
	p, e := auth.Session(ctx, result.Token)
	if e != nil || p.ID != en.UserID {
		t.Fatal(p, e)
	}
	if e = auth.Logout(ctx, result.Token); e != nil {
		t.Fatal(e)
	}
	if _, e = auth.Session(ctx, result.Token); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
	// Origin tampering invalidates the signed clientDataJSON as well as the RP policy.
	login, e = auth.BeginLogin(ctx, "webauthn@example.com")
	if e != nil {
		t.Fatal(e)
	}
	var bad map[string]any
	json.Unmarshal(key.assertion(t, login), &bad)
	response := bad["response"].(map[string]any)
	payload, _ := base64.RawURLEncoding.DecodeString(response["clientDataJSON"].(string))
	var data map[string]any
	json.Unmarshal(payload, &data)
	data["origin"] = "https://attacker.example"
	payload, _ = json.Marshal(data)
	response["clientDataJSON"] = encoded(payload)
	tampered, _ := json.Marshal(bad)
	if _, e = auth.FinishLogin(ctx, FinishInput{login.ID, tampered}); !Is(e, Unauthenticated) {
		t.Fatal("origin tampering accepted", e)
	}
	setup, e := auth.BeginTOTP(WithPrincipal(ctx, p))
	if e != nil {
		t.Fatal(e)
	}
	if u, e := url.Parse(setup.URL); e != nil || u.Scheme != "otpauth" {
		t.Fatal(setup, e)
	}
}

func TestTOTPReplayRejected(t *testing.T) {
	core, ctx, _ := fixture(t)
	auth, e := NewAuth(core, "localhost", "http://localhost:8080")
	if e != nil {
		t.Fatal(e)
	}
	en, e := auth.Bootstrap(ctx, UserInput{Email: "totp@example.com", Name: "TOTP"})
	if e != nil {
		t.Fatal(e)
	}
	p := Principal{ID: en.UserID, Email: "totp@example.com", Role: "admin", TwoFactorAt: time.Now().Unix()}
	ctx = WithPrincipal(ctx, p)
	setup, e := auth.BeginTOTP(ctx)
	if e != nil {
		t.Fatal(e)
	}
	u, _ := url.Parse(setup.URL)
	secret := u.Query().Get("secret")
	code, e := totp.GenerateCode(secret, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if e = auth.FinishTOTP(ctx, setup.ID, code); e != nil {
		t.Fatal(e)
	}
	pending, e := auth.saveChallenge(ctx, p.ID, "two_factor", struct{}{}, time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = auth.VerifyTOTP(ctx, pending, code); !Is(e, Unauthenticated) {
		t.Fatal("setup code replay", e)
	}
	pending, e = auth.saveChallenge(ctx, p.ID, "two_factor", struct{}{}, time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	next, e := totp.GenerateCode(secret, time.Now().Add(30*time.Second))
	if e != nil {
		t.Fatal(e)
	}
	session, e := auth.VerifyTOTP(ctx, pending, next)
	if e != nil || session.Token == "" {
		t.Fatal(e)
	}
	if _, e = auth.VerifyTOTP(ctx, pending, next); !Is(e, Unauthenticated) {
		t.Fatal("challenge replay", e)
	}
}
