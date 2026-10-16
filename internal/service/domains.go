package service

import (
	"context"
	"net"
	"sort"
	"time"
)

// DomainCheck reports where a domain points in DNS.
type DomainCheck struct {
	Host      string   `json:"host"`
	Addresses []string `json:"addresses"`
	Resolves  bool     `json:"resolves"`
}

// lookupHost is replaceable in tests.
var lookupHost = net.DefaultResolver.LookupHost

// CheckDomains resolves the app's domains so people can confirm their DNS
// records before a deployment needs a certificate.
func (s *appsService) CheckDomains(ctx context.Context, id string) ([]DomainCheck, error) {
	app, e := s.Get(ctx, id)
	if e != nil {
		return nil, e
	}
	out := make([]DomainCheck, 0, len(app.Config.Domains))
	for _, host := range app.Config.Domains {
		c, cancel := context.WithTimeout(ctx, 3*time.Second)
		addrs, e := lookupHost(c, host)
		cancel()
		sort.Strings(addrs)
		out = append(out, DomainCheck{Host: host, Addresses: addrs, Resolves: e == nil && len(addrs) > 0})
	}
	return out, nil
}
