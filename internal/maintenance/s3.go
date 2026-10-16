package maintenance

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
)

// S3 uses the path-style PutObject subset of Signature V4, with a streaming file
// body, a signed payload hash and redirects forbidden. Credentials never enter a URL.
type S3 struct {
	Endpoint     string       `json:"endpoint"`
	Region       string       `json:"region"`
	Bucket       string       `json:"bucket"`
	Prefix       string       `json:"prefix"`
	AccessKey    string       `json:"access_key"`
	SecretKey    string       `json:"secret_key"`
	SessionToken string       `json:"session_token,omitempty"`
	Client       *http.Client `json:"-"`
}

func LoadS3(p string) (*S3, error) {
	b, e := host.ReadSecret(p)
	if e != nil {
		return nil, e
	}
	var s S3
	if e = json.Unmarshal(b, &s); e != nil {
		return nil, errors.New("invalid S3 configuration")
	}
	if e = s.Validate(); e != nil {
		return nil, e
	}
	return &s, nil
}
func (s *S3) Validate() error {
	u, e := url.Parse(s.Endpoint)
	endpoint := e == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (u.Path == "" || u.Path == "/")
	fields := s.Region != "" && s.AccessKey != "" && s.SecretKey != "" && s.Bucket != "" &&
		!strings.ContainsAny(s.Region, "/\r\n") && !strings.ContainsAny(s.Bucket, "/\r\n") &&
		!strings.ContainsAny(s.Prefix, "\r\n") && !strings.ContainsAny(s.AccessKey+s.SessionToken, "\r\n")
	if !endpoint || !fields {
		return errors.New("invalid S3 configuration")
	}
	return nil
}
func (s *S3) Upload(ctx context.Context, file string) error {
	if e := s.Validate(); e != nil {
		return e
	}
	f, e := os.OpenFile(file, os.O_RDONLY|sysNoFollow, 0)
	if e != nil {
		return e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return e
	}
	if !st.Mode().IsRegular() {
		return errors.New("invalid backup file")
	}
	hash := sha256.New()
	if _, e = io.Copy(hash, &contextReader{ctx, f}); e != nil {
		return e
	}
	payload := hex.EncodeToString(hash.Sum(nil))
	if _, e = f.Seek(0, io.SeekStart); e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(filepath.Base(file)), f)
	if e != nil {
		return errors.New("invalid S3 request")
	}
	req.ContentLength = st.Size()
	req.Header.Set("Content-Type", "application/octet-stream")
	status, e := s.do(req, payload)
	if e != nil {
		return errors.New("S3 backup upload failed")
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("S3 backup upload rejected (HTTP %d)", status)
	}
	return nil
}

// objectURL is the path-style address of name under the configured prefix.
func (s *S3) objectURL(name string) string {
	u, _ := url.Parse(s.Endpoint)
	u.Path = "/" + s.Bucket + "/" + strings.Trim(s.Prefix, "/") + "/" + name
	if s.Prefix == "" {
		u.Path = "/" + s.Bucket + "/" + name
	}
	u.RawPath = s3Encode(u.Path)
	return u.String()
}

// do signs and sends req without following redirects, which could carry the
// signed request elsewhere, and returns the status code.
func (s *S3) do(req *http.Request, payload string) (int, error) {
	s.sign(req, payload, time.Now().UTC())
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}
	clone := *client
	clone.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, e := clone.Do(req)
	if e != nil {
		return 0, e
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	return res.StatusCode, nil
}

// Test proves the configuration can store backups: it uploads a small object
// next to where backups go, then deletes it.
func (s *S3) Test(ctx context.Context) error {
	if e := s.Validate(); e != nil {
		return e
	}
	name := "nelcota-connection-test-" + strconv.FormatInt(time.Now().UnixNano(), 36) + ".txt"
	body := []byte("NelcotaDeploy connection test\n")
	sum := sha256.Sum256(body)
	put, e := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(name), bytes.NewReader(body))
	if e != nil {
		return errors.New("invalid S3 request")
	}
	put.ContentLength = int64(len(body))
	put.Header.Set("Content-Type", "text/plain")
	status, e := s.do(put, hex.EncodeToString(sum[:]))
	if e != nil {
		return errors.New("the S3 endpoint couldn't be reached")
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("S3 refused the test upload (HTTP %d); check the bucket, region, and keys", status)
	}
	empty := sha256.Sum256(nil)
	del, e := http.NewRequestWithContext(ctx, http.MethodDelete, s.objectURL(name), nil)
	if e != nil {
		return errors.New("invalid S3 request")
	}
	status, e = s.do(del, hex.EncodeToString(empty[:]))
	if e != nil || status < 200 || status >= 300 {
		return fmt.Errorf("the test upload worked, but deleting it was refused (HTTP %d); backups still work", status)
	}
	return nil
}
func (s *S3) sign(r *http.Request, payload string, now time.Time) {
	stamp, day := now.Format("20060102T150405Z"), now.Format("20060102")
	r.Header.Set("X-Amz-Date", stamp)
	r.Header.Set("X-Amz-Content-Sha256", payload)
	headers := "host:" + r.URL.Host + "\nx-amz-content-sha256:" + payload + "\nx-amz-date:" + stamp + "\n"
	signed := "host;x-amz-content-sha256;x-amz-date"
	if s.SessionToken != "" {
		r.Header.Set("X-Amz-Security-Token", s.SessionToken)
		headers += "x-amz-security-token:" + s.SessionToken + "\n"
		signed += ";x-amz-security-token"
	}
	canonical := strings.Join([]string{r.Method, s3Encode(r.URL.Path), r.URL.Query().Encode(), headers, signed, payload}, "\n")
	sum := sha256.Sum256([]byte(canonical))
	scope := day + "/" + s.Region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + hex.EncodeToString(sum[:])
	key := mac([]byte("AWS4"+s.SecretKey), day)
	key = mac(key, s.Region)
	key = mac(key, "s3")
	key = mac(key, "aws4_request")
	r.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.AccessKey+"/"+scope+", SignedHeaders="+signed+", Signature="+hex.EncodeToString(mac(key, toSign)))
}
func mac(key []byte, s string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(s))
	return h.Sum(nil)
}

func s3Encode(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune("-._~/", rune(c)) {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}
