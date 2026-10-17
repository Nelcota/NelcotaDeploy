package main

import (
	"crypto/rand"
	"encoding/json"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
	"github.com/Nelcota/NelcotaDeploy/internal/maintenance"
	"github.com/spf13/cobra"
)

func maintenanceCommands(cfg *config) []*cobra.Command {
	var output, keyFile, s3File string
	backup := &cobra.Command{Use: "backup", Short: "Consistent encrypted snapshot of the database and keys", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		if keyFile == "" {
			keyFile = backupKeyFile(cfg.keys)
		}
		b := maintenance.Backup{Data: cfg.data, Config: cfg.keys, KeyFile: keyFile}
		if e := b.Create(cmd.Context(), output); e != nil {
			return e
		}
		if s3File != "" {
			s, e := maintenance.LoadS3(s3File)
			if e != nil {
				return e
			}
			if e = s.Upload(cmd.Context(), output); e != nil {
				return e
			}
		}
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{"backup": output})
	}}
	backup.Flags().StringVar(&output, "output", "", "New .nbk file")
	_ = backup.MarkFlagRequired("output")
	backup.Flags().StringVar(&keyFile, "key-file", "", "Independent backup key, 32 raw bytes, mode 0600")
	backup.Flags().StringVar(&s3File, "s3-config", "", "Protected S3 configuration for optional upload")
	var restoreKey string
	var replace bool
	restore := &cobra.Command{Use: "restore FILE", Short: "Restore database and keys while the panel is stopped", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		if restoreKey == "" {
			restoreKey = backupKeyFile(cfg.keys)
		}
		return (maintenance.Backup{Data: cfg.data, Config: cfg.keys, KeyFile: restoreKey}).Restore(cmd.Context(), args[0], replace)
	}}
	restore.Flags().StringVar(&restoreKey, "key-file", "", "Key used to encrypt the backup")
	restore.Flags().BoolVar(&replace, "replace", false, "Replace files and keep .before-restore copies")
	var email string
	reset := &cobra.Command{Use: "reset-totp", Short: "Local TOTP recovery while the panel is stopped", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		p, e := open(cmd.Context(), *cfg)
		if e != nil {
			return e
		}
		defer p.core.DB.Close()
		return p.auth.ResetTOTPByEmail(cmd.Context(), email)
	}}
	reset.Flags().StringVar(&email, "email", "", "Exact user email address")
	_ = reset.MarkFlagRequired("email")
	keygen := &cobra.Command{Use: "backup-keygen", Short: "Generate an independent backup key without overwriting", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		key := make([]byte, 32)
		if _, e := rand.Read(key); e != nil {
			return e
		}
		return host.WriteExclusive(output, key)
	}}
	keygen.Flags().StringVar(&output, "output", "", "New key file to store separately from backups")
	_ = keygen.MarkFlagRequired("output")
	return []*cobra.Command{backup, restore, reset, keygen}
}
