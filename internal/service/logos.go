package service

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	"image/png"
	"time"

	"golang.org/x/image/draw"
)

// LogoSize is the side of a stored app logo. Uploads share the profile photo limits.
const LogoSize = 256

// Logo is a stored app logo: a square PNG that keeps transparency.
type Logo struct {
	Image     []byte
	UpdatedAt int64
}

// SetLogo stores an app's logo. The image is decoded, fitted inside a
// transparent square without cropping, and re-encoded, so the stored file
// never carries the upload's metadata or anything else hidden in it.
func (s *appsService) SetLogo(ctx context.Context, id string, upload []byte) error {
	if _, e := authorize(ctx, "apps:write", true); e != nil {
		return e
	}
	img, e := normalizeLogo(upload)
	if e != nil {
		return e
	}
	return s.c.mutate(ctx, func(tx *sql.Tx) error {
		if e := appExists(ctx, tx, id); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO app_logos(app_id,image,updated_at) VALUES(?,?,?) ON CONFLICT(app_id) DO UPDATE SET image=excluded.image, updated_at=excluded.updated_at", id, img, time.Now().UnixMilli()); e != nil {
			return e
		}
		return s.c.audit(ctx, tx, "app.logo.set", id)
	})
}

// RemoveLogo deletes an app's logo; the app shows its initial again.
func (s *appsService) RemoveLogo(ctx context.Context, id string) error {
	if _, e := authorize(ctx, "apps:write", true); e != nil {
		return e
	}
	return s.c.mutate(ctx, func(tx *sql.Tx) error {
		if e := appExists(ctx, tx, id); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM app_logos WHERE app_id=?", id); e != nil {
			return e
		}
		return s.c.audit(ctx, tx, "app.logo.remove", id)
	})
}

// Logo returns an app's logo to anyone who can read apps.
func (s *appsService) Logo(ctx context.Context, id string) (Logo, error) {
	if _, e := authorize(ctx, "apps:read", false); e != nil {
		return Logo{}, e
	}
	var v Logo
	e := s.c.DB.Read.QueryRowContext(ctx, "SELECT image,updated_at FROM app_logos WHERE app_id=?", id).Scan(&v.Image, &v.UpdatedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return v, fail(NotFound, "No logo")
	}
	return v, dbError(e)
}

// logoVersions maps app IDs to their logo's update time.
func (s *appsService) logoVersions(ctx context.Context) (map[string]int64, error) {
	rows, e := s.c.DB.Read.QueryContext(ctx, "SELECT app_id,updated_at FROM app_logos")
	if e != nil {
		return nil, e
	}
	defer func() { _ = rows.Close() }()
	out := map[string]int64{}
	for rows.Next() {
		var id string
		var at int64
		if e := rows.Scan(&id, &at); e != nil {
			return nil, e
		}
		out[id] = at
	}
	return out, rows.Err()
}

func appExists(ctx context.Context, tx *sql.Tx, id string) error {
	var one int
	return dbError(tx.QueryRowContext(ctx, "SELECT 1 FROM apps WHERE id=?", id).Scan(&one))
}

func normalizeLogo(upload []byte) ([]byte, error) {
	src, e := decodeUpload(upload)
	if e != nil {
		return nil, e
	}
	// Fit the whole image, centered, so wide wordmarks aren't cut off.
	b := src.Bounds()
	w, h := LogoSize, LogoSize
	if b.Dx() > b.Dy() {
		h = max(1, LogoSize*b.Dy()/b.Dx())
	} else {
		w = max(1, LogoSize*b.Dx()/b.Dy())
	}
	at := image.Pt((LogoSize-w)/2, (LogoSize-h)/2)
	dst := image.NewNRGBA(image.Rect(0, 0, LogoSize, LogoSize))
	draw.CatmullRom.Scale(dst, image.Rectangle{Min: at, Max: at.Add(image.Pt(w, h))}, src, b, draw.Over, nil)
	var out bytes.Buffer
	if e := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, dst); e != nil {
		return nil, e
	}
	return out.Bytes(), nil
}
