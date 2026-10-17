-- name: GetSetting :one
SELECT encrypted FROM settings WHERE key = ?;

-- name: SaveSetting :exec
INSERT INTO settings (key, encrypted) VALUES (?, ?)
ON CONFLICT (key) DO UPDATE SET encrypted = excluded.encrypted;
