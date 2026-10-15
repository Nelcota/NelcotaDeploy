package maintenance

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestS3UploadTLSAndRedirectRejection(t *testing.T) {
	var received bool
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		sum := sha256.Sum256(b)
		if r.Method != "PUT" || r.URL.Path != "/bucket/backups/snapshot.nbk" || string(b) != "encrypted" || r.Header.Get("X-Amz-Content-Sha256") != hex.EncodeToString(sum[:]) || !strings.Contains(r.Header.Get("Authorization"), "/s3/aws4_request") || r.Header.Get("X-Amz-Security-Token") != "session" {
			t.Error("invalid signed upload")
		}
		received = true
		w.WriteHeader(200)
	}))
	defer server.Close()
	s := &S3{Endpoint: server.URL, Region: "auto", Bucket: "bucket", Prefix: "backups", AccessKey: "key", SecretKey: "secret", SessionToken: "session", Client: server.Client()}
	file := filepath.Join(t.TempDir(), "snapshot.nbk")
	_ = os.WriteFile(file, []byte("encrypted"), 0600)
	if e := s.Upload(t.Context(), file); e != nil || !received {
		t.Fatal(e)
	}
	redirect := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, server.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	s.Endpoint = redirect.URL
	s.Client = redirect.Client()
	received = false
	if e := s.Upload(t.Context(), file); e == nil || received {
		t.Fatal("followed S3 redirect", e)
	}
	s.Endpoint = "http://example.test"
	if e := s.Upload(t.Context(), file); e == nil {
		t.Fatal("accepted HTTP endpoint")
	}
}
func TestS3SignatureMatchesPublishedAWSExample(t *testing.T) {
	// AWS S3 single-chunk example, GET Bucket Lifecycle (no range header).
	// https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
	s := S3{Region: "us-east-1", AccessKey: "AKIAIOSFODNN7EXAMPLE", SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}
	r, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/?lifecycle=", nil)
	s.sign(r, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))
	// Value is the canonical AWS vector; this does not derive its expected value
	// using the production signer.
	want := "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"
	if !strings.HasSuffix(r.Header.Get("Authorization"), want) {
		t.Fatal(r.Header.Get("Authorization"))
	}
}
