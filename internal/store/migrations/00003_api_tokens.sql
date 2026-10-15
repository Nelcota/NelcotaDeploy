-- +goose Up
CREATE TABLE api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash BLOB NOT NULL UNIQUE, scopes TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX token_expiry ON api_tokens(expires_at);
-- +goose Down
DROP TABLE api_tokens;
