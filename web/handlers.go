package web

import "github.com/go-chi/chi/v5"

// publicPages are reachable without a session.
func (h *handler) publicPages(r chi.Router) {
	r.Get("/login", h.loginPage)
	r.Get("/enroll", h.enrollPage)
}

// pages require a session.
func (h *handler) pages(r chi.Router) {
	r.Get("/", h.dashboardPage)
	r.Get("/apps", h.appsPage)
	r.Get("/apps/new", h.newAppPage)
	r.Get("/apps/{id}", h.overviewPage)
	r.Get("/apps/{id}/deployments", h.deploymentsPage)
	r.Get("/apps/{id}/logs", h.logsPage)
	r.Get("/apps/{id}/settings", h.appSettingsPage)
	r.Get("/servers", h.serversPage)
	r.Get("/settings", h.accountPage)
	r.Get("/avatars/{id}", h.avatar)
	r.Get("/app-logos/{id}", h.appLogo)
	r.Get("/settings/users", h.usersPage)
	r.Get("/settings/github", h.githubPage)
	r.Get("/settings/notifications", h.notificationsPage)
	r.Get("/settings/backups", h.backupsPage)
	r.Get("/settings/audit", h.auditPage)
	r.Get("/settings/platform", h.platformPage)
	if h.cfg.Dev {
		r.Get("/dev/components", h.componentsPage)
	}
}

// actions are Datastar endpoints under /ui; mutating ones pass the CSRF middleware.
func (h *handler) actions(r chi.Router) {
	r.Get("/cmdk", h.commandPalette)
	r.Get("/stream/dashboard", h.dashboardStream)
	r.Get("/stream/apps/{id}/deployments", h.deploymentsStream)
	r.Get("/stream/apps/{id}/overview", h.overviewStream)
	r.Post("/apps/{id}/dns", h.checkDNS)
	r.Post("/apps", h.createApp)
	r.Post("/apps/new/inspect", h.inspectNewApp)
	r.Post("/apps/new/back", h.wizardBack)
	r.Post("/apps/{id}/deploy", h.deployApp)
	r.Post("/apps/{id}/settings", h.saveAppSettings)
	r.Post("/apps/{id}/env", h.setEnv)
	r.Post("/apps/{id}/env/preview", h.previewEnv)
	r.Post("/apps/{id}/env/import", h.importEnv)
	r.Post("/apps/{id}/env/{key}/delete", h.deleteEnv)
	r.Post("/apps/{id}/action/{action}", h.appAction)
	r.Post("/apps/{id}/delete", h.deleteApp)
	r.Post("/apps/{id}/logo", h.uploadLogo)
	r.Post("/apps/{id}/logo/remove", h.removeLogo)
	r.Post("/deployments/{id}/cancel", h.cancelDeployment)
	r.Post("/servers/invite", h.inviteServer)
	r.Post("/servers/{id}/prune/{scope}", h.pruneServer)
	r.Post("/servers/{id}/limits", h.serverLimits)
	r.Post("/deployments/{id}/rollback", h.rollbackDeployment)
	r.Post("/users", h.inviteUser)
	r.Post("/users/{id}/role", h.setUserRole)
	r.Post("/users/{id}/remove", h.removeUser)
	r.Post("/settings/github", h.saveGitHub)
	r.Post("/settings/backup-s3", h.saveS3)
	r.Post("/settings/backup-s3/test", h.testS3)
	r.Post("/servers/{id}/ssh/check", h.checkSSHHost)
	r.Post("/servers/{id}/ssh/install", h.installOverSSH)
	r.Get("/stream/provision/{id}", h.provisionStream)
	r.Post("/operations/backup", h.startBackup)
	r.Post("/operations/update", h.startUpdate)
	r.Post("/operations/automatic", h.setAutomaticUpdates)
	r.Post("/settings/notifications", h.saveNotifications)
	r.Post("/settings/notifications/test", h.testNotifications)
	r.Post("/settings/notifications/webhook/remove", h.removeNotificationWebhook)
	r.Post("/settings/notifications/email/remove", h.removeNotificationEmail)
	r.Post("/operations/{batch}/cancel", h.cancelOperation)
	r.Get("/operations", h.operationsFragment)
	r.Post("/account/passkeys/{id}/delete", h.removePasskey)
	r.Post("/account/avatar", h.uploadAvatar)
	r.Post("/account/avatar/remove", h.removeAvatar)
	r.Post("/account/totp/begin", h.beginTOTP)
	r.Post("/account/totp/finish", h.finishTOTP)
	r.Post("/account/totp/reset", h.resetTOTP)
	r.Post("/account/recovery-codes", h.recoveryCodes)
	r.Post("/account/tokens", h.createToken)
	r.Post("/account/tokens/{id}/revoke", h.revokeToken)
}
