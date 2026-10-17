-- name: SessionPrincipal :one
SELECT u.id, u.email, u.name, u.role, s.two_factor_at, CAST(COALESCE(a.updated_at, 0) AS INTEGER) AS avatar_at
FROM sessions s
JOIN users u ON u.id = s.user_id
LEFT JOIN avatars a ON a.user_id = u.id
WHERE s.token_hash = ? AND s.expires_at > ?;

-- name: TokenPrincipal :one
SELECT u.id, u.email, u.name, u.role, t.scopes
FROM api_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = ? AND t.expires_at > ?;

-- name: FirstStepsHidden :one
SELECT first_steps_hidden FROM users WHERE id = ?;

-- name: HideFirstSteps :exec
UPDATE users SET first_steps_hidden = 1 WHERE id = ?;
