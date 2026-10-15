package agent

import (
	"encoding/json"
	"errors"
	"os"
)

func protoJSON(v persisted) ([]byte, error) { return json.Marshal(v) }
func (s *StateStore) Load() (persisted, error) {
	var v persisted
	b, e := os.ReadFile(s.Path)
	if errors.Is(e, os.ErrNotExist) {
		return v, nil
	}
	if e != nil {
		return v, e
	}
	b, e = s.Vault.Open(b, "agent-state")
	if e != nil {
		return v, e
	}
	e = json.Unmarshal(b, &v)
	return v, e
}
