-- +goose Up
ALTER TABLE deployments ADD COLUMN timings TEXT NOT NULL DEFAULT '{}';
-- +goose Down
ALTER TABLE deployments DROP COLUMN timings;
