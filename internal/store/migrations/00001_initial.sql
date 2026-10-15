-- +goose Up
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), created_at INTEGER NOT NULL);
CREATE TABLE credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('passkey','totp')), data BLOB NOT NULL, last_used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, wireguard_ip TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'offline', heartbeat_at INTEGER NOT NULL DEFAULT 0, build_limit INTEGER NOT NULL DEFAULT 1 CHECK(build_limit BETWEEN 1 AND 8), cache_bytes INTEGER NOT NULL DEFAULT 5368709120, wg_public_key TEXT NOT NULL DEFAULT '');
CREATE TABLE apps (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, server_id TEXT NOT NULL REFERENCES servers(id), repository TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main', config TEXT NOT NULL, desired_sha TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE domains (id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE, host TEXT NOT NULL UNIQUE, https INTEGER NOT NULL DEFAULT 1);
CREATE TABLE env_vars (app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE, key TEXT NOT NULL, encrypted BLOB NOT NULL, build INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(app_id,key));
CREATE TABLE deployments (id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id), sha TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL CHECK(origin IN ('push','manual','rollback')), status TEXT NOT NULL CHECK(status IN ('queued','building','starting','success','failed','cancelled')), queued_at INTEGER NOT NULL, started_at INTEGER NOT NULL DEFAULT 0, finished_at INTEGER NOT NULL DEFAULT 0, log_ref TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '', clean INTEGER NOT NULL DEFAULT 0, check_id INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0);
CREATE INDEX deployment_queue ON deployments(app_id,status,queued_at);
CREATE UNIQUE INDEX one_active_per_app ON deployments(app_id) WHERE status IN ('building','starting');
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', ip TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
-- +goose StatementBegin
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit is append only'); END;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit is append only'); END;
-- +goose StatementEnd
CREATE TABLE sessions (token_hash BLOB PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, two_factor_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE challenges (token_hash BLOB PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL, data BLOB NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE invitations (token_hash BLOB PRIMARY KEY, server_id TEXT REFERENCES servers(id), expires_at INTEGER NOT NULL, consumed_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE webhook_deliveries (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, encrypted BLOB NOT NULL);

-- +goose Down
DROP TABLE settings;
DROP TABLE webhook_deliveries;
DROP TABLE invitations;
DROP TABLE challenges;
DROP TABLE sessions;
DROP TABLE audit_log;
DROP TABLE deployments;
DROP TABLE env_vars;
DROP TABLE domains;
DROP TABLE apps;
DROP TABLE servers;
DROP TABLE credentials;
DROP TABLE users;
