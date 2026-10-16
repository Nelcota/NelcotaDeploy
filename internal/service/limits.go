package service

import (
	"context"
	"database/sql"
)

func (s *serversService) UpdateLimits(ctx context.Context, id string, in ServerLimitsInput) (Server, error) {
	if _, e := authorize(ctx, "servers:write", true); e != nil {
		return Server{}, e
	}
	if in.BuildLimit < 1 || in.BuildLimit > 8 || in.CacheBytes < 64<<20 || in.CacheBytes > 100<<30 {
		return Server{}, fail(Validation, "Limites de build ou cache inválidos")
	}
	e := s.c.mutate(ctx, func(tx *sql.Tx) error {
		r, e := tx.ExecContext(ctx, "UPDATE servers SET build_limit=?,cache_bytes=? WHERE id=?", in.BuildLimit, in.CacheBytes, id)
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return fail(NotFound, "Server não encontrado")
		}
		return s.c.audit(ctx, tx, "server.limits", id)
	})
	if e != nil {
		return Server{}, e
	}
	server, e := s.c.DB.Queries.GetServer(ctx, id)
	return decodeServer(server), dbError(e)
}
