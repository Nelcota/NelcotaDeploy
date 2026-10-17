-- +goose Up
ALTER TABLE deployments ADD COLUMN retry_of TEXT NOT NULL DEFAULT '';
-- +goose Down
ALTER TABLE deployments DROP COLUMN retry_of;
