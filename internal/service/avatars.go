package service

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"time"

	// Accepted upload formats.
	_ "image/gif"
	_ "image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Profile photo limits. Browsers shrink photos before uploading, so the
// upload limit stays under the panel's 1 MiB request limit.
const (
	AvatarMaxBytes = 900 << 10
	AvatarSize     = 256
	avatarMinSide  = 32
	avatarMaxSide  = 6000
)

// Avatar is a stored profile photo: a square JPEG.
type Avatar struct {
	Image     []byte
	UpdatedAt int64
}

// SetAvatar stores the signed-in person's profile photo. The image is decoded,
// cropped to its centered square, scaled, and re-encoded, so the stored file
// never carries the upload's metadata or anything else hidden in it.
func (a *AuthService) SetAvatar(ctx context.Context, upload []byte) error {
	p, e := require(ctx, false)
	if e != nil {
		return e
	}
	if p.Scopes != nil {
		return fail(Forbidden, "Interactive session required")
	}
	img, e := normalizeAvatar(upload)
	if e != nil {
		return e
	}
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "INSERT INTO avatars(user_id,image,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET image=excluded.image, updated_at=excluded.updated_at", p.ID, img, time.Now().UnixMilli()); e != nil {
			return e
		}
		return a.Core.audit(ctx, tx, "user.avatar.set", p.ID)
	})
}

// RemoveAvatar deletes the signed-in person's profile photo.
func (a *AuthService) RemoveAvatar(ctx context.Context) error {
	p, e := require(ctx, false)
	if e != nil {
		return e
	}
	if p.Scopes != nil {
		return fail(Forbidden, "Interactive session required")
	}
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "DELETE FROM avatars WHERE user_id=?", p.ID); e != nil {
			return e
		}
		return a.Core.audit(ctx, tx, "user.avatar.remove", p.ID)
	})
}

// Avatar returns a team member's profile photo to any signed-in person.
func (a *AuthService) Avatar(ctx context.Context, userID string) (Avatar, error) {
	if _, e := require(ctx, false); e != nil {
		return Avatar{}, e
	}
	var v Avatar
	e := a.Core.DB.Read.QueryRowContext(ctx, "SELECT image,updated_at FROM avatars WHERE user_id=?", userID).Scan(&v.Image, &v.UpdatedAt)
	if errors.Is(e, sql.ErrNoRows) {
		return v, fail(NotFound, "No profile photo")
	}
	return v, dbError(e)
}

func normalizeAvatar(upload []byte) ([]byte, error) {
	src, e := decodeUpload(upload)
	if e != nil {
		return nil, e
	}
	b := src.Bounds()
	side := min(b.Dx(), b.Dy())
	crop := image.Rect(b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2, 0, 0)
	crop.Max = crop.Min.Add(image.Pt(side, side))
	dst := image.NewRGBA(image.Rect(0, 0, AvatarSize, AvatarSize))
	// JPEG has no transparency; transparent pixels become white.
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Over, nil)
	var out bytes.Buffer
	if e := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 85}); e != nil {
		return nil, e
	}
	return out.Bytes(), nil
}

// decodeUpload checks an uploaded image's size and format and decodes it.
func decodeUpload(upload []byte) (image.Image, error) {
	if len(upload) == 0 {
		return nil, fail(Validation, "Choose an image")
	}
	if len(upload) > AvatarMaxBytes {
		return nil, fail(Validation, "The image is too large")
	}
	// Check dimensions before decoding so a small file can't expand into a huge image.
	cfg, _, e := image.DecodeConfig(bytes.NewReader(upload))
	if e != nil {
		return nil, fail(Validation, "Use a JPEG, PNG, GIF, or WebP image")
	}
	if cfg.Width < avatarMinSide || cfg.Height < avatarMinSide || cfg.Width > avatarMaxSide || cfg.Height > avatarMaxSide {
		return nil, fail(Validation, "Use an image between 32 and 6000 pixels on each side")
	}
	src, _, e := image.Decode(bytes.NewReader(upload))
	if e != nil {
		return nil, fail(Validation, "Use a JPEG, PNG, GIF, or WebP image")
	}
	return src, nil
}
