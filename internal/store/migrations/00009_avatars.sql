-- +goose Up
CREATE TABLE avatars (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, image BLOB NOT NULL, updated_at INTEGER NOT NULL);
-- +goose Down
DROP TABLE avatars;
