-- +goose Up
CREATE TABLE log_cleanup (deployment_id TEXT PRIMARY KEY);

-- +goose Down
DROP TABLE log_cleanup;
