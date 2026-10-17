-- +goose Up
-- Per-person interface preferences. first_steps_hidden records that someone
-- dismissed the setup checklist on Home.
ALTER TABLE users ADD COLUMN first_steps_hidden INTEGER NOT NULL DEFAULT 0;
-- +goose Down
ALTER TABLE users DROP COLUMN first_steps_hidden;
