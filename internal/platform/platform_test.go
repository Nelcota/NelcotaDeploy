package platform

import (
	"go.uber.org/goleak"
	"testing"
)

func TestMain(m *testing.M)     { goleak.VerifyTestMain(m) }
func TestScaffold(t *testing.T) { t.Helper() }
