-- +goose Up
CREATE TABLE recovery_codes(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash BLOB PRIMARY KEY, used_at INTEGER NOT NULL DEFAULT 0);
-- +goose Down
DROP TABLE recovery_codes;
