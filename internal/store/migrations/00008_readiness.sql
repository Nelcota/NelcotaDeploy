-- +goose Up
ALTER TABLE servers ADD COLUMN agent_ready INTEGER NOT NULL DEFAULT 0;
-- +goose Down
ALTER TABLE servers DROP COLUMN agent_ready;
