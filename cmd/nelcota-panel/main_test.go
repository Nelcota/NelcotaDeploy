package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestInitializeKeepsExistingKeys(t *testing.T) {
	dir := t.TempDir()
	c := config{data: filepath.Join(dir, "data"), keys: filepath.Join(dir, "keys"), control: "10.77.0.1:8443"}
	if e := initialize(t.Context(), c); e != nil {
		t.Fatal(e)
	}
	files := []string{"backup.key", "master.key", "signing.key", "ca.pem", "ca.key", "control.pem", "control.key"}
	before := map[string][]byte{}
	for _, name := range files {
		b, e := os.ReadFile(filepath.Join(c.keys, name))
		if e != nil || len(b) == 0 {
			t.Fatal(name, e)
		}
		before[name] = b
	}
	if e := initialize(t.Context(), c); e != nil {
		t.Fatal(e)
	}
	for _, name := range files {
		if b, _ := os.ReadFile(filepath.Join(c.keys, name)); !bytes.Equal(b, before[name]) {
			t.Fatal(name, "replaced")
		}
	}
}

func TestBackupKeyFileHonorsEnvironment(t *testing.T) {
	t.Setenv("NELCOTA_BACKUP_KEY_FILE", "")
	if got := backupKeyFile("/etc/nelcota"); got != "/etc/nelcota/backup.key" {
		t.Fatal(got)
	}
	t.Setenv("NELCOTA_BACKUP_KEY_FILE", "/srv/keys/backup.key")
	if got := backupKeyFile("/etc/nelcota"); got != "/srv/keys/backup.key" {
		t.Fatal(got)
	}
}

func TestOpenDerivesSeparateCSRFKey(t *testing.T) {
	dir := t.TempDir()
	c := config{data: filepath.Join(dir, "data"), keys: filepath.Join(dir, "keys"), control: "10.77.0.1:8443", origin: "https://panel.example.com"}
	if e := initialize(t.Context(), c); e != nil {
		t.Fatal(e)
	}
	p, e := open(t.Context(), c)
	if e != nil {
		t.Fatal(e)
	}
	defer p.core.DB.Close()
	master, _ := os.ReadFile(filepath.Join(c.keys, "master.key"))
	if len(p.csrf) != 32 || bytes.Equal(p.csrf, master) {
		t.Fatal("CSRF key must be a distinct 32-byte subkey")
	}
}
