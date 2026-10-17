-- name: CountOnlineServer :one
SELECT count(*) FROM servers WHERE id = ? AND status = 'online' AND heartbeat_at > ?;

-- name: ConnectAgent :execrows
-- The previous certificate stays valid until previous_cert_until during renewal.
UPDATE servers SET status = 'online', agent_ready = 0, heartbeat_at = sqlc.arg(now)
WHERE id = sqlc.arg(id)
  AND (fingerprint = sqlc.arg(fingerprint) OR (previous_fingerprint = sqlc.arg(fingerprint) AND previous_cert_until > sqlc.arg(now)));

-- name: RecordHeartbeat :exec
UPDATE servers SET heartbeat_at = ?, status = 'online', agent_version = ?, agent_ready = ? WHERE id = ?;

-- name: PendingInvitation :one
SELECT s.id, s.wireguard_ip, s.build_limit, s.cache_bytes
FROM invitations i
JOIN servers s ON s.id = i.server_id
WHERE i.token_hash = ? AND i.consumed_at = 0 AND i.expires_at > ?;
