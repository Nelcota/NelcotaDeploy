package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"strings"
	"time"
)

type TokenInput struct {
	Name     string   `json:"name"`
	Scopes   []string `json:"scopes"`
	TTLHours int      `json:"ttl_hours"`
}
type APIToken struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Scopes    []string `json:"scopes"`
	ExpiresAt int64    `json:"expires_at"`
	Token     string   `json:"token,omitempty"`
}

func authorize(ctx context.Context, scope string, admin bool) (Principal, error) {
	p, e := require(ctx, admin)
	if e != nil {
		return p, e
	}
	if p.Scopes == nil {
		return p, nil
	}
	for _, allowed := range p.Scopes {
		if allowed == scope || strings.HasSuffix(scope, ":read") && allowed == strings.TrimSuffix(scope, ":read")+":write" {
			return p, nil
		}
	}
	return p, fail(Forbidden, "Token sem o escopo necessário")
}

var validScopes = map[string]bool{"apps:read": true, "apps:write": true, "deploys:read": true, "deploys:write": true, "servers:read": true, "servers:write": true, "logs:read": true, "users:write": true, "settings:write": true, "audit:read": true}

func (a *AuthService) CreateToken(ctx context.Context, in TokenInput) (APIToken, error) {
	p, e := require(ctx, true)
	if e != nil {
		return APIToken{}, e
	}
	if p.Scopes != nil || time.Now().Unix()-p.TwoFactorAt > 300 {
		return APIToken{}, fail(Forbidden, "Reautenticação interativa necessária")
	}
	if len(in.Name) < 1 || len(in.Name) > 80 || len(in.Scopes) == 0 || len(in.Scopes) > len(validScopes) {
		return APIToken{}, fail(Validation, "Token inválido")
	}
	seen := map[string]bool{}
	for _, s := range in.Scopes {
		if !validScopes[s] || seen[s] {
			return APIToken{}, fail(Validation, "Escopo inválido ou duplicado")
		}
		seen[s] = true
	}
	if in.TTLHours == 0 {
		in.TTLHours = 24
	}
	if in.TTLHours < 1 || in.TTLHours > 720 {
		return APIToken{}, fail(Validation, "Validade deve ser de 1 a 720 horas")
	}
	out := APIToken{ID: security.Token(), Name: in.Name, Scopes: in.Scopes, ExpiresAt: time.Now().Add(time.Duration(in.TTLHours) * time.Hour).Unix(), Token: "nd_" + security.Token()}
	scopes, _ := json.Marshal(in.Scopes)
	e = a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "INSERT INTO api_tokens(id,user_id,name,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?,?)", out.ID, p.ID, out.Name, security.Hash(out.Token), string(scopes), out.ExpiresAt, time.Now().Unix()); e != nil {
			return e
		}
		return a.Core.audit(ctx, tx, "auth.token.create", out.ID)
	})
	return out, e
}
func (a *AuthService) Tokens(ctx context.Context) ([]APIToken, error) {
	p, e := require(ctx, true)
	if e != nil {
		return nil, e
	}
	if p.Scopes != nil {
		return nil, fail(Forbidden, "Sessão interativa necessária")
	}
	rows, e := a.Core.DB.Read.QueryContext(ctx, "SELECT id,name,scopes,expires_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC", p.ID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []APIToken{}
	for rows.Next() {
		var token APIToken
		var scopes string
		if e = rows.Scan(&token.ID, &token.Name, &scopes, &token.ExpiresAt); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(scopes), &token.Scopes); e != nil {
			return nil, e
		}
		out = append(out, token)
	}
	return out, rows.Err()
}
func (a *AuthService) RevokeToken(ctx context.Context, id string) error {
	p, e := require(ctx, true)
	if e != nil {
		return e
	}
	if p.Scopes != nil {
		return fail(Forbidden, "Sessão interativa necessária")
	}
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		r, e := tx.ExecContext(ctx, "DELETE FROM api_tokens WHERE id=? AND user_id=?", id, p.ID)
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return fail(NotFound, "Token inexistente")
		}
		return a.Core.audit(ctx, tx, "auth.token.revoke", id)
	})
}
func (a *AuthService) AuthenticateToken(ctx context.Context, token string) (Principal, error) {
	var p Principal
	var scopes string
	e := a.Core.DB.Read.QueryRowContext(ctx, "SELECT u.id,u.email,u.name,u.role,t.scopes FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?", security.Hash(token), time.Now().Unix()).Scan(&p.ID, &p.Email, &p.Name, &p.Role, &scopes)
	if e != nil {
		return p, fail(Unauthenticated, "Token inválido")
	}
	if e = json.Unmarshal([]byte(scopes), &p.Scopes); e != nil || len(p.Scopes) == 0 {
		return p, fail(Unauthenticated, "Escopos inválidos")
	}
	return p, nil
}
