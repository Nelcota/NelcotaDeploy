package service

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"

	"net/mail"

	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

type Auth interface {
	RecoveryCodes(context.Context) ([]string, error)
	VerifyRecovery(context.Context, string, string) (LoginResult, error)
	ResetTOTP(context.Context) error
	CreateToken(context.Context, TokenInput) (APIToken, error)
	Tokens(context.Context) ([]APIToken, error)
	RevokeToken(context.Context, string) error
	AuthenticateToken(context.Context, string) (Principal, error)
	BeginRegistration(context.Context, RegistrationInput) (Ceremony, error)
	FinishRegistration(context.Context, FinishInput) error
	BeginLogin(context.Context, string) (Ceremony, error)
	FinishLogin(context.Context, FinishInput) (LoginResult, error)
	VerifyTOTP(context.Context, string, string) (LoginResult, error)
	BeginTOTP(context.Context) (TOTPSetup, error)
	FinishTOTP(context.Context, string, string) error
	Session(context.Context, string) (Principal, error)
	Logout(context.Context, string) error
}
type Users interface {
	List(context.Context) ([]Principal, error)
	Create(context.Context, UserInput) (Enrollment, error)
}
type RegistrationInput struct {
	EnrollmentToken string `json:"enrollment_token"`
}
type FinishInput struct {
	CeremonyID string          `json:"ceremony_id"`
	Credential json.RawMessage `json:"credential"`
}
type Ceremony struct {
	ID        string          `json:"ceremony_id"`
	Options   json.RawMessage `json:"options"`
	ExpiresAt time.Time       `json:"expires_at"`
}
type LoginResult struct {
	Token        string    `json:"-"`
	ExpiresAt    time.Time `json:"expires_at"`
	RequiresTOTP bool      `json:"requires_totp"`
	Challenge    string    `json:"challenge,omitempty"`
}
type TOTPSetup struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}
type UserInput struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}
type Enrollment struct {
	UserID    string    `json:"user_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}
type authData struct {
	Session    webauthn.SessionData `json:"session"`
	Enrollment string               `json:"enrollment,omitempty"`
}
type authUser struct {
	Principal
	Credentials []webauthn.Credential
}

func (u authUser) WebAuthnID() []byte                         { return []byte(u.ID) }
func (u authUser) WebAuthnName() string                       { return u.Email }
func (u authUser) WebAuthnDisplayName() string                { return u.Name }
func (u authUser) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }

type AuthService struct {
	Core     *Core
	WebAuthn *webauthn.WebAuthn
}

func NewAuth(c *Core, rpID, origin string) (*AuthService, error) {
	w, e := webauthn.New(&webauthn.Config{RPDisplayName: "Nelcota Deploy", RPID: rpID, RPOrigins: []string{origin}, AuthenticatorSelection: protocol.AuthenticatorSelection{UserVerification: protocol.VerificationRequired}})
	return &AuthService{c, w}, e
}
func (a *AuthService) user(ctx context.Context, id string) (authUser, error) {
	r, e := a.Core.DB.Queries.GetUser(ctx, id)
	if e != nil {
		return authUser{}, e
	}
	u := authUser{Principal: Principal{ID: r.ID, Email: r.Email, Name: r.Name, Role: r.Role}}
	creds, e := a.Core.DB.Queries.GetCredentials(ctx, id)
	if e != nil {
		return u, e
	}
	for _, r := range creds {
		if r.Kind != "passkey" {
			continue
		}
		var c webauthn.Credential
		if e = json.Unmarshal(r.Data, &c); e != nil {
			return u, e
		}
		u.Credentials = append(u.Credentials, c)
	}
	return u, nil
}
func (a *AuthService) saveChallenge(ctx context.Context, user, purpose string, data any, ttl time.Duration) (string, error) {
	b, e := json.Marshal(data)
	if e != nil {
		return "", e
	}
	token := security.Token()
	_, e = a.Core.DB.Write.ExecContext(ctx, "INSERT INTO challenges(token_hash,user_id,purpose,data,expires_at) VALUES(?,?,?,?,?)", security.Hash(token), user, purpose, b, time.Now().Add(ttl).Unix())
	return token, e
}
func (a *AuthService) takeChallenge(ctx context.Context, token, purpose string) (string, []byte, error) {
	var user string
	var data []byte
	e := a.Core.DB.Write.QueryRowContext(ctx, "DELETE FROM challenges WHERE token_hash=? AND purpose=? AND expires_at>? RETURNING user_id,data", security.Hash(token), purpose, time.Now().Unix()).Scan(&user, &data)
	if e != nil {
		return "", nil, fail(Unauthenticated, "Desafio inválido ou expirado")
	}
	return user, data, nil
}
func (a *AuthService) BeginRegistration(ctx context.Context, in RegistrationInput) (Ceremony, error) {
	var id string
	if in.EnrollmentToken != "" {
		e := a.Core.DB.Read.QueryRowContext(ctx, "SELECT user_id FROM challenges WHERE token_hash=? AND purpose='enroll' AND expires_at>?", security.Hash(in.EnrollmentToken), time.Now().Unix()).Scan(&id)
		if e != nil {
			return Ceremony{}, fail(Unauthenticated, "Convite inválido")
		}
	} else {
		p, e := require(ctx, false)
		if e != nil {
			return Ceremony{}, e
		}
		if time.Now().Unix()-p.TwoFactorAt > 300 {
			return Ceremony{}, fail(Forbidden, "Reautenticação necessária")
		}
		id = p.ID
	}
	u, e := a.user(ctx, id)
	if e != nil {
		return Ceremony{}, fail(Unauthenticated, "Usuário inválido")
	}
	o, s, e := a.WebAuthn.BeginRegistration(u)
	if e != nil {
		return Ceremony{}, fail(Validation, "Não foi possível iniciar registro")
	}
	b, _ := json.Marshal(o)
	token, e := a.saveChallenge(ctx, id, "registration", authData{*s, in.EnrollmentToken}, 5*time.Minute)
	return Ceremony{token, b, time.Now().Add(5 * time.Minute)}, e
}
func (a *AuthService) FinishRegistration(ctx context.Context, in FinishInput) error {
	id, b, e := a.takeChallenge(ctx, in.CeremonyID, "registration")
	if e != nil {
		return e
	}
	var data authData
	if e = json.Unmarshal(b, &data); e != nil {
		return e
	}
	if data.Enrollment == "" {
		p, e := require(ctx, false)
		if e != nil || p.ID != id {
			return fail(Forbidden, "Sessão de registro inválida")
		}
	}
	u, e := a.user(ctx, id)
	if e != nil {
		return e
	}
	parsed, e := protocol.ParseCredentialCreationResponseBytes(in.Credential)
	if e != nil {
		return fail(Validation, "Credencial inválida")
	}
	cred, e := a.WebAuthn.CreateCredential(u, data.Session, parsed)
	if e != nil {
		return fail(Unauthenticated, "Registro recusado")
	}
	b, e = json.Marshal(cred)
	if e != nil {
		return e
	}
	requestActor, _ := CurrentUser(ctx)
	u.Principal.IP = requestActor.IP
	ctx = WithPrincipal(ctx, u.Principal)
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if data.Enrollment != "" {
			r, e := tx.ExecContext(ctx, "DELETE FROM challenges WHERE token_hash=? AND user_id=? AND purpose='enroll' AND expires_at>?", security.Hash(data.Enrollment), id, time.Now().Unix())
			if e != nil {
				return e
			}
			n, _ := r.RowsAffected()
			if n != 1 {
				return fail(Unauthenticated, "Convite utilizado")
			}
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO credentials(id,user_id,kind,data) VALUES(?,?,'passkey',?)", base64.RawURLEncoding.EncodeToString(cred.ID), id, b); e != nil {
			return dbError(e)
		}
		return a.Core.audit(ctx, tx, "auth.passkey.register", id)
	})
}
func (a *AuthService) BeginLogin(ctx context.Context, email string) (Ceremony, error) {
	r, e := a.Core.DB.Queries.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if e != nil {
		return Ceremony{}, fail(Unauthenticated, "Login indisponível para esta conta")
	}
	u, e := a.user(ctx, r.ID)
	if e != nil {
		return Ceremony{}, e
	}
	o, s, e := a.WebAuthn.BeginLogin(u, webauthn.WithUserVerification(protocol.VerificationRequired))
	if e != nil {
		return Ceremony{}, fail(Unauthenticated, "Login indisponível para esta conta")
	}
	b, _ := json.Marshal(o)
	id, e := a.saveChallenge(ctx, u.ID, "login", authData{Session: *s}, 5*time.Minute)
	return Ceremony{id, b, time.Now().Add(5 * time.Minute)}, e
}
func (a *AuthService) FinishLogin(ctx context.Context, in FinishInput) (LoginResult, error) {
	id, b, e := a.takeChallenge(ctx, in.CeremonyID, "login")
	if e != nil {
		return LoginResult{}, e
	}
	var data authData
	if e = json.Unmarshal(b, &data); e != nil {
		return LoginResult{}, e
	}
	u, e := a.user(ctx, id)
	if e != nil {
		return LoginResult{}, e
	}
	parsed, e := protocol.ParseCredentialRequestResponseBytes(in.Credential)
	if e != nil {
		return LoginResult{}, fail(Validation, "Resposta inválida")
	}
	cred, e := a.WebAuthn.ValidateLogin(u, data.Session, parsed)
	if e != nil || cred.Authenticator.CloneWarning {
		return LoginResult{}, fail(Unauthenticated, "Login recusado")
	}
	b, e = json.Marshal(cred)
	if e != nil {
		return LoginResult{}, e
	}
	_, e = a.Core.DB.Write.ExecContext(ctx, "UPDATE credentials SET data=?,last_used=? WHERE id=? AND user_id=?", b, time.Now().Unix(), base64.RawURLEncoding.EncodeToString(cred.ID), id)
	if e != nil {
		return LoginResult{}, e
	}
	var n int
	e = a.Core.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM credentials WHERE user_id=? AND kind='totp'", id).Scan(&n)
	if e != nil {
		return LoginResult{}, e
	}
	if n > 0 {
		token, e := a.saveChallenge(ctx, id, "two_factor", struct{}{}, 5*time.Minute)
		return LoginResult{RequiresTOTP: true, Challenge: token}, e
	}
	return a.issueSession(ctx, id)
}
func (a *AuthService) issueSession(ctx context.Context, user string) (LoginResult, error) {
	token := security.Token()
	expires := time.Now().Add(time.Hour)
	e := a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at,two_factor_at) VALUES(?,?,?,?)", security.Hash(token), user, expires.Unix(), time.Now().Unix()); e != nil {
			return e
		}
		requestActor, _ := CurrentUser(ctx)
		return a.Core.audit(WithPrincipal(ctx, Principal{ID: user, IP: requestActor.IP}), tx, "auth.login", user)
	})
	return LoginResult{Token: token, ExpiresAt: expires}, e
}
func (a *AuthService) Session(ctx context.Context, token string) (Principal, error) {
	var p Principal
	e := a.Core.DB.Read.QueryRowContext(ctx, "SELECT u.id,u.email,u.name,u.role,s.two_factor_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", security.Hash(token), time.Now().Unix()).Scan(&p.ID, &p.Email, &p.Name, &p.Role, &p.TwoFactorAt)
	if e != nil {
		return p, fail(Unauthenticated, "Sessão inválida")
	}
	return p, nil
}
func (a *AuthService) Logout(ctx context.Context, token string) error {
	_, e := a.Core.DB.Write.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=?", security.Hash(token))
	return e
}
func (a *AuthService) BeginTOTP(ctx context.Context) (TOTPSetup, error) {
	p, e := require(ctx, false)
	if e != nil {
		return TOTPSetup{}, e
	}
	if time.Now().Unix()-p.TwoFactorAt > 300 {
		return TOTPSetup{}, fail(Forbidden, "Reautenticação necessária")
	}
	k, e := totp.Generate(totp.GenerateOpts{Issuer: "Nelcota Deploy", AccountName: p.Email})
	if e != nil {
		return TOTPSetup{}, e
	}
	encrypted, e := a.Core.Vault.Seal([]byte(k.Secret()), "totp:"+p.ID)
	if e != nil {
		return TOTPSetup{}, e
	}
	id, e := a.saveChallenge(ctx, p.ID, "totp_setup", encrypted, 5*time.Minute)
	return TOTPSetup{id, k.URL()}, e
}
func otpCounter(secret, code string, now time.Time) (int64, error) {
	opts := totp.ValidateOpts{Period: 30, Skew: 0, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1}
	for delta := -1; delta <= 1; delta++ {
		stamp := now.Add(time.Duration(delta) * 30 * time.Second)
		value, e := totp.GenerateCodeCustom(secret, stamp, opts)
		if e == nil && subtle.ConstantTimeCompare([]byte(value), []byte(code)) == 1 {
			return stamp.Unix() / 30, nil
		}
	}
	return 0, fail(Unauthenticated, "Código inválido")
}
func (a *AuthService) FinishTOTP(ctx context.Context, id, code string) error {
	p, e := require(ctx, false)
	if e != nil {
		return e
	}
	user, b, e := a.takeChallenge(ctx, id, "totp_setup")
	if e != nil || user != p.ID {
		return fail(Unauthenticated, "Desafio inválido")
	}
	var encrypted []byte
	if e = json.Unmarshal(b, &encrypted); e != nil {
		return e
	}
	secret, e := a.Core.Vault.Open(encrypted, "totp:"+user)
	if e != nil {
		return e
	}
	counter, e := otpCounter(string(secret), code, time.Now())
	if e != nil {
		return e
	}
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "INSERT INTO credentials(id,user_id,kind,data,last_used) VALUES(?,?,'totp',?,?)", "totp-"+user, user, encrypted, counter); e != nil {
			return fail(Conflict, "TOTP já configurado")
		}
		return a.Core.audit(ctx, tx, "auth.totp.enable", user)
	})
}
func (a *AuthService) VerifyTOTP(ctx context.Context, challenge, code string) (LoginResult, error) {
	user, _, e := a.takeChallenge(ctx, challenge, "two_factor")
	if e != nil {
		return LoginResult{}, e
	}
	var b []byte
	var last int64
	if e = a.Core.DB.Read.QueryRowContext(ctx, "SELECT data,last_used FROM credentials WHERE user_id=? AND kind='totp'", user).Scan(&b, &last); e != nil {
		return LoginResult{}, fail(Unauthenticated, "Código inválido")
	}
	secret, e := a.Core.Vault.Open(b, "totp:"+user)
	if e != nil {
		return LoginResult{}, e
	}
	counter, e := otpCounter(string(secret), code, time.Now())
	if e != nil || counter <= last {
		return LoginResult{}, fail(Unauthenticated, "Código inválido ou reutilizado")
	}
	r, e := a.Core.DB.Write.ExecContext(ctx, "UPDATE credentials SET last_used=? WHERE user_id=? AND kind='totp' AND last_used<?", counter, user, counter)
	if e != nil {
		return LoginResult{}, e
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return LoginResult{}, fail(Unauthenticated, "Código reutilizado")
	}
	return a.issueSession(ctx, user)
}
func (a *AuthService) List(ctx context.Context) ([]Principal, error) {
	if _, e := authorize(ctx, "users:write", true); e != nil {
		return nil, e
	}
	r, e := a.Core.DB.Queries.ListUsers(ctx)
	out := make([]Principal, 0, len(r))
	for _, u := range r {
		out = append(out, Principal{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role})
	}
	return out, dbError(e)
}
func (a *AuthService) Create(ctx context.Context, in UserInput) (Enrollment, error) {
	if _, e := authorize(ctx, "users:write", true); e != nil {
		return Enrollment{}, e
	}
	return a.create(ctx, in, false)
}
func (a *AuthService) Bootstrap(ctx context.Context, in UserInput) (Enrollment, error) {
	in.Role = "admin"
	return a.create(systemContext(ctx), in, true)
}
func (a *AuthService) create(ctx context.Context, in UserInput, first bool) (Enrollment, error) {
	address, e := mail.ParseAddress(in.Email)
	if e != nil || address.Address != in.Email || len(in.Name) < 1 || len(in.Name) > 120 || (in.Role != "admin" && in.Role != "member") {
		return Enrollment{}, fail(Validation, "Usuário inválido")
	}
	id := security.Token()
	token := security.Token()
	expires := time.Now().Add(15 * time.Minute)
	e = a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if first {
			var n int
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n); e != nil {
				return e
			}
			if n != 0 {
				return fail(Conflict, "Administrador já inicializado")
			}
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)", id, strings.ToLower(in.Email), in.Name, in.Role, time.Now().Unix()); e != nil {
			return dbError(e)
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO challenges(token_hash,user_id,purpose,data,expires_at) VALUES(?,?,'enroll','{}',?)", security.Hash(token), id, expires.Unix()); e != nil {
			return e
		}
		return a.Core.audit(ctx, tx, "user.create", id)
	})
	return Enrollment{id, token, expires}, e
}
func (a *AuthService) Cleanup(ctx context.Context) error {
	if _, e := a.Core.DB.Write.ExecContext(ctx, "UPDATE servers SET pending_certificate=NULL,previous_fingerprint='',previous_cert_until=0 WHERE previous_cert_until>0 AND previous_cert_until<?", time.Now().Unix()); e != nil {
		return e
	}
	for _, table := range []string{"challenges", "sessions", "api_tokens"} {
		if _, e := a.Core.DB.Write.ExecContext(ctx, "DELETE FROM "+table+" WHERE expires_at<?", time.Now().Unix()); e != nil {
			return e
		}
	}
	return nil
}
