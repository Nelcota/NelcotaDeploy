package main

import (
	"encoding/json"
	"github.com/nelcota/nelcota-deploy/internal/maintenance"
	"github.com/spf13/cobra"
	"path/filepath"
)

func maintenanceCommands(cfg *config) []*cobra.Command {
	var output, keyFile, s3File string
	backup := &cobra.Command{Use: "backup", Short: "Snapshot consistente e criptografado do banco e chaves", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		if keyFile == "" {
			keyFile = filepath.Join(cfg.keys, "backup.key")
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
	backup.Flags().StringVar(&output, "output", "", "Arquivo novo .nbk")
	_ = backup.MarkFlagRequired("output")
	backup.Flags().StringVar(&keyFile, "key-file", "", "Chave independente de backup, raw 32 bytes, modo 0600")
	backup.Flags().StringVar(&s3File, "s3-config", "", "Configuração S3 protegida para upload opcional")
	var restoreKey string
	var replace bool
	restore := &cobra.Command{Use: "restore ARQUIVO", Short: "Restaura banco e chaves com o painel parado", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		if restoreKey == "" {
			restoreKey = filepath.Join(cfg.keys, "backup.key")
		}
		return (maintenance.Backup{Data: cfg.data, Config: cfg.keys, KeyFile: restoreKey}).Restore(cmd.Context(), args[0], replace)
	}}
	restore.Flags().StringVar(&restoreKey, "key-file", "", "Chave usada para criptografar o backup")
	restore.Flags().BoolVar(&replace, "replace", false, "Substitui arquivos e mantém cópias .before-restore")
	return []*cobra.Command{backup, restore}
}
