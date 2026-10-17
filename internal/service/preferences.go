package service

import (
	"context"

	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
)

// Preferences are the signed-in person's own interface choices.
type Preferences struct {
	FirstStepsHidden bool `json:"first_steps_hidden"`
}

// Preferences returns the signed-in person's interface preferences.
func (a *AuthService) Preferences(ctx context.Context) (Preferences, error) {
	p, e := require(ctx, false)
	if e != nil {
		return Preferences{}, e
	}
	hidden, e := dbgen.New(a.Core.DB.Read).FirstStepsHidden(ctx, p.ID)
	if e != nil {
		return Preferences{}, dbError(e)
	}
	return Preferences{FirstStepsHidden: hidden != 0}, nil
}

// HideFirstSteps dismisses the setup checklist on Home for the signed-in
// person only. It belongs to interactive sessions, not API tokens.
func (a *AuthService) HideFirstSteps(ctx context.Context) error {
	p, e := require(ctx, false)
	if e != nil {
		return e
	}
	if p.Scopes != nil {
		return fail(Forbidden, "Interactive session required")
	}
	if e := dbgen.New(a.Core.DB.Write).HideFirstSteps(ctx, p.ID); e != nil {
		return dbError(e)
	}
	return nil
}
