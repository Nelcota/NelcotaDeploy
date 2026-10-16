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

	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
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
	Factors(context.Context) (Factors, error)
	RemovePasskey(context.Context, string) error
	SetAvatar(context.Context, []byte) error
	RemoveAvatar(context.Context) error
	Avatar(context.Context, string) (Avatar, error)
	Preferences(context.Context) (Preferences, error)
	HideFirstSteps(context.Context) error
}
type Users interface {
	List(context.Context) ([]Principal, error)
	Create(context.Context, UserInput) (Enrollment, error)
	SetRole(context.Context, string, string) error
	Remove(context.Context, string) error
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
	w, e := webauthn.New(&webauthn.Config{RPDisplayName: "NelcotaDeploy", RPID: rpID, RPOrigins: []string{origin}, AuthenticatorSelection: protocol.AuthenticatorSelection{UserVerification: protocol.VerificationRequired}})
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

// Keep challenge consumption, credential checks and session creation under the
// single writer. Resetting credentials cannot interleave with an in-flight login.
// A failed attempt still consumes its challenge, but rolls back all other writes.
func (a *AuthService) consumeChallenge(ctx context.Context, token, purpose string, fn func(*sql.Tx, string, []byte) error) error {
	var rejected error
	e := a.Core.mutate(ctx, func(tx *sql.Tx) error {
		var user string
		var data []byte
		if e := tx.QueryRowContext(ctx, "DELETE FROM challenges WHERE token_hash=? AND purpose=? AND expires_at>? RETURNING user_id,data", security.Hash(token), purpose, time.Now().Unix()).Scan(&user, &data); e != nil {
			if e == sql.ErrNoRows {
				return fail(Unauthenticated, "Invalid or expired challenge")
			}
			return e
		}
		if _, e := tx.ExecContext(ctx, "SAVEPOINT authentication"); e != nil {
			return e
		}
		rejected = fn(tx, user, data)
		if rejected != nil {
			if _, e := tx.ExecContext(ctx, "ROLLBACK TO authentication"); e != nil {
				return e
			}
		}
		_, e := tx.ExecContext(ctx, "RELEASE authentication")
		return e
	})
	if e != nil {
		return e
	}
	return rejected
}
func saveChallengeTx(ctx context.Context, tx *sql.Tx, user, purpose string, data any, ttl time.Duration) (string, error) {
	b, e := json.Marshal(data)
	if e != nil {
		return "", e
	}
	token := security.Token()
	_, e = tx.ExecContext(ctx, "INSERT INTO challenges(token_hash,user_id,purpose,data,expires_at) VALUES(?,?,?,?,?)", security.Hash(token), user, purpose, b, time.Now().Add(ttl).Unix())
	return token, e
}
func (a *AuthService) BeginRegistration(ctx context.Context, in RegistrationInput) (Ceremony, error) {
	var id string
	if in.EnrollmentToken != "" {
		e := a.Core.DB.Read.QueryRowContext(ctx, "SELECT user_id FROM challenges WHERE token_hash=? AND purpose='enroll' AND expires_at>?", security.Hash(in.EnrollmentToken), time.Now().Unix()).Scan(&id)
		if e != nil {
			return Ceremony{}, fail(Unauthenticated, "Invalid invitation")
		}
	} else {
		p, e := freshInteractive(ctx, false)
		if e != nil {
			return Ceremony{}, e
		}
		id = p.ID
	}
	u, e := a.user(ctx, id)
	if e != nil {
		return Ceremony{}, fail(Unauthenticated, "Invalid user")
	}
	o, s, e := a.WebAuthn.BeginRegistration(u)
	if e != nil {
		return Ceremony{}, fail(Validation, "Could not start registration")
	}
	b, _ := json.Marshal(o)
	token, e := a.saveChallenge(ctx, id, "registration", authData{*s, in.EnrollmentToken}, 5*time.Minute)
	return Ceremony{token, b, time.Now().Add(5 * time.Minute)}, e
}
func (a *AuthService) FinishRegistration(ctx context.Context, in FinishInput) error {
	return a.consumeChallenge(ctx, in.CeremonyID, "registration", func(tx *sql.Tx, id string, b []byte) error {
		var e error
		var data authData
		if e = json.Unmarshal(b, &data); e != nil {
			return e
		}
		if data.Enrollment == "" {
			p, e := require(ctx, false)
			if e != nil || p.ID != id {
				return fail(Forbidden, "Invalid registration session")
			}
		}
		u, e := a.user(ctx, id)
		if e != nil {
			return e
		}
		parsed, e := protocol.ParseCredentialCreationResponseBytes(in.Credential)
		if e != nil {
			return fail(Validation, "Invalid credential")
		}
		cred, e := a.WebAuthn.CreateCredential(u, data.Session, parsed)
		if e != nil {
			return fail(Unauthenticated, "Registration rejected")
		}
		b, e = json.Marshal(cred)
		if e != nil {
			return e
		}
		requestActor, _ := CurrentUser(ctx)
		u.Principal.IP = requestActor.IP
		ctx = WithPrincipal(ctx, u.Principal)
		if data.Enrollment != "" {
			r, e := tx.ExecContext(ctx, "DELETE FROM challenges WHERE token_hash=? AND user_id=? AND purpose='enroll' AND expires_at>?", security.Hash(data.Enrollment), id, time.Now().Unix())
			if e != nil {
				return e
			}
			n, _ := r.RowsAffected()
			if n != 1 {
				return fail(Unauthenticated, "Invitation already used")
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
		return Ceremony{}, fail(Unauthenticated, "Login unavailable for this account")
	}
	u, e := a.user(ctx, r.ID)
	if e != nil {
		return Ceremony{}, e
	}
	o, s, e := a.WebAuthn.BeginLogin(u, webauthn.WithUserVerification(protocol.VerificationRequired))
	if e != nil {
		return Ceremony{}, fail(Unauthenticated, "Login unavailable for this account")
	}
	b, _ := json.Marshal(o)
	id, e := a.saveChallenge(ctx, u.ID, "login", authData{Session: *s}, 5*time.Minute)
	return Ceremony{id, b, time.Now().Add(5 * time.Minute)}, e
}
func (a *AuthService) FinishLogin(ctx context.Context, in FinishInput) (LoginResult, error) {
	var result LoginResult
	e := a.consumeChallenge(ctx, in.CeremonyID, "login", func(tx *sql.Tx, id string, b []byte) error {
		var data authData
		if e := json.Unmarshal(b, &data); e != nil {
			return e
		}
		u, e := a.user(ctx, id)
		if e != nil {
			return e
		}
		parsed, e := protocol.ParseCredentialRequestResponseBytes(in.Credential)
		if e != nil {
			return fail(Validation, "Invalid response")
		}
		cred, e := a.WebAuthn.ValidateLogin(u, data.Session, parsed)
		if e != nil || cred.Authenticator.CloneWarning {
			return fail(Unauthenticated, "Login rejected")
		}
		b, e = json.Marshal(cred)
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE credentials SET data=?,last_used=? WHERE id=? AND user_id=?", b, time.Now().Unix(), base64.RawURLEncoding.EncodeToString(cred.ID), id); e != nil {
			return e
		}
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM credentials WHERE user_id=? AND kind='totp'", id).Scan(&n); e != nil {
			return e
		}
		if n > 0 {
			token, e := saveChallengeTx(ctx, tx, id, "two_factor", struct{}{}, 5*time.Minute)
			result = LoginResult{RequiresTOTP: true, Challenge: token}
			return e
		}
		result, e = a.issueSessionTx(ctx, tx, id)
		return e
	})
	if e != nil {
		return LoginResult{}, e
	}
	return result, nil
}
func (a *AuthService) issueSession(ctx context.Context, user string) (LoginResult, error) {
	var result LoginResult
	e := a.Core.mutate(ctx, func(tx *sql.Tx) error {
		var e error
		result, e = a.issueSessionTx(ctx, tx, user)
		return e
	})
	if e != nil {
		return LoginResult{}, e
	}
	return result, nil
}
func (a *AuthService) issueSessionTx(ctx context.Context, tx *sql.Tx, user string) (LoginResult, error) {
	token := security.Token()
	expires := time.Now().Add(time.Hour)
	if _, e := tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at,two_factor_at) VALUES(?,?,?,?)", security.Hash(token), user, expires.Unix(), time.Now().Unix()); e != nil {
		return LoginResult{}, e
	}
	requestActor, _ := CurrentUser(ctx)
	e := a.Core.audit(WithPrincipal(ctx, Principal{ID: user, IP: requestActor.IP}), tx, "auth.login", user)
	return LoginResult{Token: token, ExpiresAt: expires}, e
}
func (a *AuthService) Session(ctx context.Context, token string) (Principal, error) {
	r, e := a.Core.DB.Queries.SessionPrincipal(ctx, dbgen.SessionPrincipalParams{TokenHash: security.Hash(token), ExpiresAt: time.Now().Unix()})
	if e != nil {
		return Principal{}, fail(Unauthenticated, "Invalid session")
	}
	return Principal{ID: r.ID, Email: r.Email, Name: r.Name, Role: r.Role, TwoFactorAt: r.TwoFactorAt, AvatarAt: r.AvatarAt}, nil
}
func (a *AuthService) Logout(ctx context.Context, token string) error {
	_, e := a.Core.DB.Write.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=?", security.Hash(token))
	return e
}
func (a *AuthService) BeginTOTP(ctx context.Context) (TOTPSetup, error) {
	p, e := freshInteractive(ctx, false)
	if e != nil {
		return TOTPSetup{}, e
	}
	k, e := totp.Generate(totp.GenerateOpts{Issuer: "NelcotaDeploy", AccountName: p.Email})
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
	return 0, fail(Unauthenticated, "Invalid code")
}
func (a *AuthService) FinishTOTP(ctx context.Context, id, code string) error {
	p, e := freshInteractive(ctx, false)
	if e != nil {
		return e
	}
	return a.consumeChallenge(ctx, id, "totp_setup", func(tx *sql.Tx, user string, b []byte) error {
		if user != p.ID {
			return fail(Unauthenticated, "Invalid challenge")
		}
		var encrypted []byte
		if e := json.Unmarshal(b, &encrypted); e != nil {
			return e
		}
		secret, e := a.Core.Vault.Open(encrypted, "totp:"+user)
		if e != nil {
			return e
		}
		defer clear(secret)
		counter, e := otpCounter(string(secret), code, time.Now())
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO credentials(id,user_id,kind,data,last_used) VALUES(?,?,'totp',?,?)", "totp-"+user, user, encrypted, counter); e != nil {
			return fail(Conflict, "TOTP already configured")
		}
		// Sessions established before enabling the second factor must not retain
		// access. Require a new passkey + TOTP login, and discard pending logins.
		for _, table := range []string{"sessions", "api_tokens", "challenges"} {
			if _, e = tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE user_id=?", user); e != nil {
				return e
			}
		}
		return a.Core.audit(ctx, tx, "auth.totp.enable", user)
	})
}
func (a *AuthService) VerifyTOTP(ctx context.Context, challenge, code string) (LoginResult, error) {
	var result LoginResult
	e := a.consumeChallenge(ctx, challenge, "two_factor", func(tx *sql.Tx, user string, _ []byte) error {
		var b []byte
		var last int64
		if e := tx.QueryRowContext(ctx, "SELECT data,last_used FROM credentials WHERE user_id=? AND kind='totp'", user).Scan(&b, &last); e != nil {
			return fail(Unauthenticated, "Invalid code")
		}
		secret, e := a.Core.Vault.Open(b, "totp:"+user)
		if e != nil {
			return e
		}
		defer clear(secret)
		counter, e := otpCounter(string(secret), code, time.Now())
		if e != nil || counter <= last {
			return fail(Unauthenticated, "Invalid or previously used code")
		}
		if _, e = tx.ExecContext(ctx, "UPDATE credentials SET last_used=? WHERE user_id=? AND kind='totp'", counter, user); e != nil {
			return e
		}
		result, e = a.issueSessionTx(ctx, tx, user)
		return e
	})
	if e != nil {
		return LoginResult{}, e
	}
	return result, nil
}
func (a *AuthService) List(ctx context.Context) ([]Principal, error) {
	if _, e := authorize(ctx, "users:write", true); e != nil {
		return nil, e
	}
	r, e := a.Core.DB.Queries.ListUsers(ctx)
	out := make([]Principal, 0, len(r))
	for _, u := range r {
		out = append(out, Principal{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role, AvatarAt: u.AvatarAt})
	}
	return out, dbError(e)
}
func (a *AuthService) Create(ctx context.Context, in UserInput) (Enrollment, error) {
	if _, e := authorize(ctx, "users:write", true); e != nil {
		return Enrollment{}, e
	}
	return a.create(ctx, in, false, InvitationLifetime)
}

// InvitationLifetime is how long a person's invitation link works. It is
// single use, and only the token's hash is stored.
const InvitationLifetime = 24 * time.Hour

// Bootstrap creates the first administrator. Its invitation is written to a
// private file on the panel host by the installer, so it stays short-lived.
func (a *AuthService) Bootstrap(ctx context.Context, in UserInput) (Enrollment, error) {
	in.Role = "admin"
	return a.create(systemContext(ctx), in, true, 15*time.Minute)
}
func (a *AuthService) create(ctx context.Context, in UserInput, first bool, lifetime time.Duration) (Enrollment, error) {
	address, e := mail.ParseAddress(in.Email)
	if e != nil || address.Address != in.Email || len(in.Name) < 1 || len(in.Name) > 120 || (in.Role != "admin" && in.Role != "member") {
		return Enrollment{}, fail(Validation, "Invalid user")
	}
	id := security.Token()
	token := security.Token()
	expires := time.Now().Add(lifetime)
	e = a.Core.mutate(ctx, func(tx *sql.Tx) error {
		if first {
			var n int
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n); e != nil {
				return e
			}
			if n != 0 {
				return fail(Conflict, "Administrator already initialized")
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
