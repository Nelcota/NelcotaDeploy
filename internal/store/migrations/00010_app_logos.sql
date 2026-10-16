-- +goose Up
CREATE TABLE app_logos (app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE, image BLOB NOT NULL, updated_at INTEGER NOT NULL);
-- +goose Down
DROP TABLE app_logos;
