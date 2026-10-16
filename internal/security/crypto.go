package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/host"
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
	b, err := host.ReadPrivate(path, 32)
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
	Path     string
	loaded   bool
}

func (v *Verifier) Verify(c *agentv1.Command, now time.Time) error {
	if c.Id == "" || len(c.Id) > 128 || c.ServerId != v.ServerID || c.IssuedUnix > now.Unix()+5 || c.ExpiresUnix < now.Unix() || c.ExpiresUnix-c.IssuedUnix > 60 || c.ExpiresUnix <= c.IssuedUnix {
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
	if !v.loaded && v.Path != "" {
		b, e := host.ReadPrivate(v.Path, 2<<20)
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return errors.New("replay journal unavailable")
		}
		if len(b) > 0 {
			if e = json.Unmarshal(b, &v.seen); e != nil {
				return errors.New("invalid replay journal")
			}
		}
		v.loaded = true
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
	if v.Path != "" {
		b, e := json.Marshal(v.seen)
		if e != nil {
			return e
		}
		if e = os.MkdirAll(filepath.Dir(v.Path), 0700); e != nil {
			return e
		}
		f, e := os.CreateTemp(filepath.Dir(v.Path), ".replay-")
		if e != nil {
			return e
		}
		defer os.Remove(f.Name())
		if e = f.Chmod(0600); e == nil {
			_, e = f.Write(b)
		}
		if e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
		if e = os.Rename(f.Name(), v.Path); e != nil {
			return e
		}
	}
	return nil
}

// Redactor is immutable and safe for concurrent use. Mask both raw and URL-encoded credentials at callers.
type Redactor struct{ secrets []string }

func NewRedactor(values []string) *Redactor {
	r := &Redactor{}
	for _, s := range values {
		if s != "" {
			r.secrets = append(r.secrets, s, url.QueryEscape(s), url.PathEscape(s), base64.StdEncoding.EncodeToString([]byte(s)), base64.RawURLEncoding.EncodeToString([]byte(s)))
		}
	}
	sort.Slice(r.secrets, func(i, j int) bool { return len(r.secrets[i]) > len(r.secrets[j]) })
	return r
}
func (r *Redactor) Mask(s string) string {
	for _, secret := range r.secrets {
		s = strings.ReplaceAll(s, secret, "[REDACTED]")
	}
	return s
}
