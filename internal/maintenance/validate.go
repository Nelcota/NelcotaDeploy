package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"net/url"
	"path/filepath"
)

// Validate master-key compatibility before installing any restored files.
func validateSecrets(ctx context.Context, stage string) error {
	key, e := security.LoadKey(filepath.Join(stage, "config/master.key"))
	if e != nil {
		return e
	}
	v, e := security.NewVault(key)
	if e != nil {
		return e
	}
	db, e := sql.Open("sqlite3", (&url.URL{Scheme: "file", Path: filepath.Join(stage, "panel.db")}).String()+"?mode=ro")
	if e != nil {
		return e
	}
	defer db.Close()
	queries := []string{"SELECT encrypted,app_id||':'||key FROM env_vars", "SELECT encrypted,'setting:'||key FROM settings", "SELECT data,'totp:'||user_id FROM credentials WHERE kind='totp'"}
	var pendingCertificates int
	if e = db.QueryRowContext(ctx, "SELECT count(*) FROM pragma_table_info('servers') WHERE name='pending_certificate'").Scan(&pendingCertificates); e != nil {
		return e
	}
	if pendingCertificates != 0 {
		queries = append(queries, "SELECT pending_certificate,'certificate:'||id FROM servers WHERE pending_certificate IS NOT NULL")
	}
	for _, query := range queries {
		rows, e := db.QueryContext(ctx, query)
		if e != nil {
			return e
		}
		for rows.Next() {
			var encrypted []byte
			var aad string
			if e = rows.Scan(&encrypted, &aad); e != nil {
				_ = rows.Close()
				return e
			}
			plain, e := v.Open(encrypted, aad)
			clear(plain)
			if e != nil {
				_ = rows.Close()
				return errors.New("backup master key does not match encrypted data")
			}
		}
		e = rows.Err()
		_ = rows.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
