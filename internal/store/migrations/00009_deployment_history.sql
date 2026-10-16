-- +goose Up
CREATE INDEX deployment_history ON deployments(app_id, queued_at DESC);

-- +goose Down
DROP INDEX deployment_history;
