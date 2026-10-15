package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"sync"
	"time"

	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"google.golang.org/protobuf/proto"
)

func Token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func Hash(token string) []byte { h := sha256.Sum256([]byte(token)); return h[:] }
func LoadKey(path string) ([]byte, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.Mode().Perm()&0077 != 0 {
		return nil, errors.New("master key permissions must be 0600")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(b) != 32 {
		return nil, errors.New("master key must contain 32 bytes")
	}
	return b, nil
}

type Vault struct{ aead cipher.AEAD }

func NewVault(key []byte) (*Vault, error) {
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("AES-256 key required")
	}
	a, err := cipher.NewGCM(b)
	return &Vault{aead: a}, err
}
func (v *Vault) Seal(value []byte, scope string) ([]byte, error) {
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return v.aead.Seal(nonce, nonce, value, []byte(scope)), nil
}
func (v *Vault) Open(value []byte, scope string) ([]byte, error) {
	n := v.aead.NonceSize()
	if len(value) < n {
		return nil, errors.New("invalid encrypted value")
	}
	return v.aead.Open(nil, value[:n], value[n:], []byte(scope))
}

func commandBytes(c *agentv1.Command) ([]byte, error) {
	copy := proto.Clone(c).(*agentv1.Command)
	copy.Signature = nil
	return proto.MarshalOptions{Deterministic: true}.Marshal(copy)
}
func Sign(c *agentv1.Command, key ed25519.PrivateKey) error {
	b, err := commandBytes(c)
	if err != nil {
		return err
	}
	c.Signature = ed25519.Sign(key, b)
	return nil
}

type Verifier struct {
	mu       sync.Mutex
	seen     map[string]int64
	Key      ed25519.PublicKey
	ServerID string
}

func (v *Verifier) Verify(c *agentv1.Command, now time.Time) error {
	if c.Id == "" || c.ServerId != v.ServerID || c.IssuedUnix > now.Unix()+5 || c.ExpiresUnix < now.Unix() || c.ExpiresUnix-c.IssuedUnix > 60 || c.ExpiresUnix <= c.IssuedUnix {
		return errors.New("invalid command envelope")
	}
	if c.Action == nil && c.Desired == nil {
		return errors.New("missing typed action")
	}
	b, err := commandBytes(c)
	if err != nil || !ed25519.Verify(v.Key, b, c.Signature) {
		return errors.New("invalid command signature")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.seen == nil {
		v.seen = make(map[string]int64)
	}
	for id, expiry := range v.seen {
		if expiry < now.Unix() {
			delete(v.seen, id)
		}
	}
	if _, ok := v.seen[c.Id]; ok {
		return errors.New("replayed command")
	}
	if len(v.seen) >= 10000 {
		return errors.New("command rate exceeded")
	}
	v.seen[c.Id] = c.ExpiresUnix
	return nil
}

// Redactor is immutable and safe for concurrent use. Mask both raw and URL-encoded credentials at callers.
type Redactor struct{ secrets []string }

func NewRedactor(values []string) *Redactor {
	r := &Redactor{}
	for _, s := range values {
		if s != "" {
			r.secrets = append(r.secrets, s)
		}
	}
	return r
}
func (r *Redactor) Mask(s string) string {
	for _, secret := range r.secrets {
		s = strings.ReplaceAll(s, secret, "[REDACTED]")
	}
	return s
}
