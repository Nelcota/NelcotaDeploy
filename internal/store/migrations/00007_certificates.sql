-- +goose Up
ALTER TABLE servers ADD COLUMN previous_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN previous_cert_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN cert_expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN pending_certificate BLOB;
-- +goose Down
ALTER TABLE servers DROP COLUMN pending_certificate;
ALTER TABLE servers DROP COLUMN cert_expires_at;
ALTER TABLE servers DROP COLUMN previous_cert_until;
ALTER TABLE servers DROP COLUMN previous_fingerprint;
