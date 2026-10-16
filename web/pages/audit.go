package pages

// AuditLabels names activity actions for people. The codes stay available
// as filter values and in each label's title.
var AuditLabels = map[string]string{
	"auth.login":                      "Signed in",
	"auth.passkey.register":           "Added a passkey",
	"auth.passkey.remove":             "Removed a passkey",
	"auth.totp.enable":                "Turned on two-factor authentication",
	"auth.totp.reset":                 "Reset two-factor authentication",
	"auth.recovery.generate":          "Created recovery codes",
	"auth.recovery.use":               "Signed in with a recovery code",
	"auth.token.create":               "Created an API token",
	"auth.token.revoke":               "Revoked an API token",
	"user.create":                     "Invited someone",
	"user.remove":                     "Removed someone from the team",
	"user.role.admin":                 "Made someone an administrator",
	"user.role.member":                "Made someone a member",
	"user.avatar.set":                 "Changed a profile photo",
	"user.avatar.remove":              "Removed a profile photo",
	"app.save":                        "Saved app settings",
	"app.port":                        "Changed an app's port",
	"app.delete":                      "Deleted an app",
	"app.logo.set":                    "Changed an app's logo",
	"app.logo.remove":                 "Removed an app's logo",
	"env.patch":                       "Changed environment variables",
	"deploy.enqueue":                  "Started publishing",
	"deploy.cancel":                   "Cancelled a deployment",
	"server.invite":                   "Added a server",
	"server.enroll":                   "A server connected",
	"server.limits":                   "Changed a server's build limits",
	"server.prune.cache":              "Cleared the build cache",
	"server.prune.orphan_images":      "Removed unused images",
	"server.prune.orphan_images.auto": "Removed unused images automatically",
	"server.provision.ssh":            "Installed a server over SSH",
	"server.certificate.renew":        "Renewed a server certificate",
	"agent.update.request":            "Asked a server to update",
	"github.configure":                "Connected the GitHub App",
	"settings.update":                 "Changed a setting",
	"notifications.configure":         "Changed notifications",
	"backup.request":                  "Started a backup",
	"update.request":                  "Started a system update",
	"operation.cancel":                "Cancelled a backup or update",
	"operation.applied":               "A backup or update finished",
	"operation.failed":                "A backup or update failed",
	"operation.cancelled":             "A backup or update was cancelled",
	"http.request":                    "HTTP request",
}

// AuditLabel is an action's name for people, or the code when it has none.
func AuditLabel(action string) string {
	if l, ok := AuditLabels[action]; ok {
		return l
	}
	return action
}
