-- name: ListApps :many
SELECT * FROM apps ORDER BY name;
-- name: GetApp :one
SELECT * FROM apps WHERE id = ?;
-- name: ListServers :many
SELECT * FROM servers ORDER BY name;
-- name: GetServer :one
SELECT * FROM servers WHERE id = ?;
-- name: ListDeployments :many
SELECT * FROM deployments WHERE app_id = ? ORDER BY queued_at DESC, rowid DESC LIMIT 100;
-- name: GetDeployment :one
SELECT * FROM deployments WHERE id = ?;
-- name: LatestDeployments :many
SELECT d.* FROM apps a JOIN deployments d ON d.rowid = (
    SELECT rowid FROM deployments WHERE app_id = a.id ORDER BY queued_at DESC, rowid DESC LIMIT 1
);
-- name: ListUsers :many
SELECT id,email,name,role,created_at FROM users ORDER BY email;
-- name: GetUser :one
SELECT * FROM users WHERE id = ?;
-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = ?;
-- name: ListAudit :many
SELECT * FROM audit_log ORDER BY id DESC LIMIT ?;
-- name: GetEnvironment :many
SELECT * FROM env_vars WHERE app_id = ? ORDER BY key;
-- name: GetDomains :many
SELECT host FROM domains WHERE app_id = ? ORDER BY host;
-- name: GetCredentials :many
SELECT * FROM credentials WHERE user_id = ?;
