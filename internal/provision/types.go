package provision

type JoinInput struct {
	Token              string `json:"token"`
	WireGuardPublicKey string `json:"wireguard_public_key"`
}
type JoinResult struct {
	ServerID          string `json:"server_id"`
	Address           string `json:"address"`
	PanelAddress      string `json:"panel_address"`
	PanelEndpoint     string `json:"panel_endpoint"`
	PanelWireGuardKey string `json:"panel_wireguard_key"`
	CA                string `json:"ca"`
	Certificate       string `json:"certificate"`
	PrivateKey        string `json:"private_key"`
	SigningKey        string `json:"signing_key"`
	ControlURL        string `json:"control_url"`
	BuildLimit        int64  `json:"build_limit"`
	CacheBytes        int64  `json:"cache_bytes"`
}
