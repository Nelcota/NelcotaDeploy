-- +goose Up
-- The one definition of a deployment that holds a build slot; queries use this
-- view instead of repeating the status list. The one_active_per_app index keeps
-- its own copy because SQLite indexes cannot reference views.
CREATE VIEW active_deployments AS SELECT id, app_id, sha, status, started_at, cancel_requested FROM deployments WHERE status IN ('building', 'starting');
-- +goose Down
DROP VIEW active_deployments;
