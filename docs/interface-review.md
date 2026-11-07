# Interface review

Reviewed the current panel in an isolated seeded environment, including navigation,
project pages, administration and dialogs. The review preserves the current visual identity,
feature boundaries, existing automation and confirmations for important actions.

## Improvements

- Project and administration navigation expose horizontal scroll controls and keep the active
  section fully visible. Resizing or changing sections does not scroll the main page vertically.
- Project settings include permission-aware shortcuts into the long form. Following a shortcut
  preserves unsaved edits and never submits the form.
- Task actions wrap on narrow screens, keeping toggles, execution, history, editing and deletion
  reachable. Schedule explanations can wrap instead of losing their meaning to truncation.
- Long project names remain readable in mobile lists and project headers. Long branch names wrap
  safely, and status values such as “Sem contêiner” stay readable in small tiles.
- Segmented filters support arrow keys, Home and End, with one tab stop per group.
- Audit events for servers, databases, volumes, GitHub connections and repository credentials
  have Portuguese labels and matching area icons.
- Missing pages and route failures have Portuguese recovery screens instead of default internal
  messages. Retrying a route failure reloads the page to retry its data requests.

## Verification scope

The browser matrix covers 21 authenticated pages, login, initial administrator setup and eight
dialogs in light and dark themes at 375 px and 1440 px. Additional interaction checks cover widths of 320, 375, 768, 1024 and
1440 px, keyboard navigation, mobile menus, settings shortcuts, profile-photo dialogs,
task confirmation cancellation, unknown addresses and retrying a route after a network failure.

Checks use real application routes, authorization and an isolated SQLite database. External
GitHub and DNS boundaries use local fixtures. The review does not execute production deploys,
DNS changes, database restores or destructive actions. Screenshots and machine-readable
accessibility results are generated under the ignored `ui-review-output/full-review/` directory.

## Follow-up: pending operations and recovery

- Token creation keeps its dialog and reviewed fields locked while the request is pending.
  Its one-time receipt starts masked, keeps the MCP example collapsed and requires explicit
  acknowledgement before dismissal. Long token names wrap in the list.
- Task saves report failures inline and preserve the draft for retry, without leaving an
  unhandled promise rejection. Pending saves cannot be cancelled or edited.
- Organization and project forms preserve touched drafts across background refreshes. Saving
  resets the form to the normalized saved values; fields stay locked during the write.
- First-run setup separates account creation from automatic sign-in. If sign-in fails after
  creation, it offers the normal login screen instead of another account-creation attempt.
- GitHub sign-in and sign-out failures provide Portuguese feedback and allow retry.
- Profile photo dialogs remain available throughout uploads or removals. Existing confirmation
  before removing a photo remains in place.
- Notifications appear at the top so copy feedback does not cover modal footer actions.

Additional isolated browser checks exercise delayed requests, rejected and failed requests,
credential copying, failed-then-successful task saves, background refreshes during editing,
normalization after saving, and developer/viewer navigation and server authorization. OAuth
provider success and production infrastructure operations remain outside this review.

## Follow-up: applying changes and following production logs

- Pending variable, domain and database changes keep their notice while a production deployment
  is queued or running. The notice follows the server state across navigation and reloads and
  links directly to that deployment. Failed or cancelled deployments allow another explicit
  attempt when configuration is still pending; reading status never queues a deployment.
- The project response includes only the identity and status of the latest active production
  deployment. Preview deployments do not block or replace this production progress.
- Runtime logs offer an explicit automatic production selection, alongside fixed deployments
  and all recent deployments. Automatic selection switches the stream when production changes;
  a fixed selection keeps its deployment. Changing projects resets the selection.
- The runtime deployment picker refreshes when production changes, keeps a label for a fixed
  deployment outside the recent list and offers retry when history requests fail. A history
  failure does not prevent following the current production stream.

Additional isolated browser checks cover deployment progress, navigation and reloads, failed and
cancelled outcomes, explicit retries, production stream changes, pinned history, unfiltered logs
and history request recovery. Light and dark layouts at 320 px and 1440 px pass WCAG A/AA checks.
Deployment execution and production infrastructure changes remain outside these browser checks.

## Follow-up: guided task scheduling

- Task scheduling starts with on-demand execution and offers interval, hourly, daily and
  weekday controls. Choosing a time or days generates the cron expression automatically;
  the readable explanation keeps the panel's configured time zone visible.
- Existing common expressions populate these controls, including weekday lists and ranges.
  Advanced or unsupported expressions stay in the custom editor without being rewritten.
  Explicitly selecting the custom editor keeps it available while typing a common expression.
- Interval choices divide an hour evenly so their duration stays consistent across hour
  boundaries. Weekly schedules always retain at least one selected day.
- Generated cron stays available in a disclosure. Weekday controls wrap on narrow screens,
  and the dialog keeps the existing scroll and footer behavior.
- Saving a new active schedule or materially changing one keeps the existing activation
  review. On-demand tasks and name-only edits do not gain another confirmation. Generating
  or cancelling a draft never creates execution jobs.

Native tests cover parsing, generation, unsupported expressions, numeric bounds and actual
execution times from the Bun scheduler in the panel time zone. Isolated browser checks cover
draft review, failed-save recovery, existing schedules, custom expressions and on-demand saves.
Keyboard-only checks cover frequency selection, time controls, weekday toggles and the generated
expression disclosure. Six scheduling modes pass layout and WCAG A/AA checks in both themes at
320 px, 768 px and 1440 px.

## Follow-up: remaining setup forms

- Server registration keeps its fields, SSH settings and cancellation locked while saving.
  Escape and the dialog close control cannot hide an in-flight registration.
- Repository credential fields stay locked during writes, preserving the reviewed value until
  the request finishes. Access verification disables its retry control while fetching.
- Cloudflare connection and disconnection are mutually exclusive while either write is pending.
  A failed connection-status read offers retry without reloading or changing DNS records.

Additional isolated browser checks hold the requests open to verify these states, exercise
Cloudflare disconnection cancellation and confirm encrypted repository credential storage.
Twelve additional light/dark states at 320 px and 1440 px pass layout and WCAG A/AA checks.
No SSH installation, task execution or DNS record update is performed by these browser checks.

## Follow-up: discovering background operations

- Deployment histories continue checking for new entries every 15 seconds when idle, including
  empty lists and status filters. Active deployments keep the existing five-second cadence.
  Cursor pagination refreshes loaded pages; the browser checks cover a multi-page list without
  duplicate rows.
- An open task history discovers scheduled executions even after previous executions finished,
  with a 15-second idle cadence and three-second updates while executions are active.
- An open backup dialog discovers scheduled backups at the same idle cadence and follows
  backups and restores every three seconds. Conflicting actions remain disabled while an
  operation is pending or the list cannot be read. Retrying a failed read restores the controls.
  An in-flight write cannot be dismissed, while queued work can be left running after acknowledgement.
- Task history uses the popover surface for readable status contrast in both themes. Long names
  wrap clear of the close button, and the current command stays in a disclosure so long arguments
  do not push execution results out of view. The command and output remain keyboard-scrollable.
- Execution output offers explicit copying, preserves original whitespace and wraps long tokens.
  Failures have a Portuguese notice, with the original technical details in a disclosure.

Native tests cover idle and active refresh policies, empty histories, pending restores, output
visibility and escaping. Isolated browser checks exercise background insertions and status changes
through real read APIs, filtered and paginated deployment histories, task output copying and keyboard
scrolling, backup conflict detection, read recovery, and unchanged execution/restore confirmations.
Clipboard verification uses a browser shim. The only queued action is an explicit backup request
in a temporary database; no worker, production deployment, task run, restore or DNS change is executed.

## Follow-up: one function per settings page

- Project settings now have eight independent routes: identity, repository, build, runtime,
  automation, volumes, server assignment and deletion. Repository credentials stay with the
  repository they authorize. Build fields and runtime fields no longer share a page.
- Administration has ten independent destinations: organization identity, automatic domains,
  alerts, users, servers, system health, GitHub, Cloudflare, API tokens and audit history.
  Provider connections and alert delivery no longer appear in unrelated forms.
- Navigation uses links to real pages. Legacy administration tab URLs and project settings
  anchors redirect to their corresponding destinations, preserving permission checks.
- Writes validate and select only fields owned by the requested page, then merge them with
  the latest saved configuration inside a writer transaction. Saving a stale page cannot
  overwrite changes made on another settings page. Unsaved forms confirm before navigation,
  and pending saves prevent leaving the form.

Verification includes the full repository check, a production build and isolated browser
checks of all 18 destinations at 320 px and 1440 px in light and dark themes. The browser
matrix checks headings, field ownership, horizontal overflow and WCAG A/AA accessibility.
Interaction checks cover old links, cancelled and confirmed navigation, independent saves
across stale tabs, read-only developer/viewer screens, restricted direct URLs and server
permission enforcement. Native tests cover scoped schemas, unrelated submitted fields,
automatic port preservation, repository reapproval and transaction rollback on conflicts.
No production deployment, DNS change, server move or deletion is executed by these checks.

## Follow-up: reviewing server moves

- Server assignment reads the current source, deployment approval, production activity and local
  storage before enabling a move. Volume and database counts link directly to their management
  pages. Read failures disable the operation and offer an explicit retry.
- The only ready destination is suggested automatically. The source is excluded, unavailable
  destinations are identified, and multiple ready alternatives require a choice. Choices are
  scoped to the project and source; a completed move does not suggest moving back immediately.
- Confirmation freezes the reviewed source revision, live version and destination. The backend
  checks that revision, destination readiness, approval and local resources again under a writer
  transaction. Existing production work cannot be silently replaced by a move.
- Assignment, deployment creation, queue insertion and audit events commit together. Missing
  source images and queue failures leave the original assignment intact. Moving an undeployed
  project changes its next deployment location without starting a deployment.
- Confirmation explains which servers are involved and distinguishes the next deployment from
  redeploying a live application. DNS remains a separate reviewed action.

Native tests use real services and SQLite transactions to cover source conflicts, resource
changes, active production, previews, approval, unavailable destinations, idempotent retries
and rollback after actual queue insertion failures. Browser verification uses an isolated
database without a worker; confirmed moves only change that fixture and queue fixture jobs.
Interaction checks cover cancellation, an unavailable destination after confirmation, stale
source revisions, actual queue failures, frozen destination selection, read recovery and
administrative permission enforcement for developer and viewer roles. Four server states pass
layout and WCAG A/AA checks in both themes at 320 px, 768 px and 1440 px. Four additional states
at 320 × 480 and 844 × 360 cover long source/destination names and keyboard-only review and
cancellation. Confirmation dialogs now share the ordinary dialog height limit and scrolling,
with a pinned action footer that keeps both choices visible on short screens. No worker, SSH, production move,
storage migration or DNS record update runs during these checks.

## Follow-up: responsibility review of the remaining pages

The remaining routes were reviewed by their user-facing purpose. Independent workflows now
have dedicated destinations instead of sharing a dashboard, long page or history overlay.

| Previous page      | Separate responsibilities and destinations                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home               | Application health at `/`, deployment activity at `/activity`, server metrics at `/server-metrics`                                                                               |
| All deployments    | History at `/deployments`, analysis at `/deployment-statistics`                                                                                                                  |
| Project overview   | Current application status, previews at `/projects/:id/previews`, resource monitoring on the existing metrics page, deployment history and configuration on their existing pages |
| Variables          | Saved variables, `.env` file imports and repository-template imports on three separate routes                                                                                    |
| Domains            | Domain associations and DNS diagnostics/provider changes on separate pages                                                                                                       |
| Deployment details | Deployment progress and build output on separate routes; runtime output remains on the application logs page                                                                     |
| Tasks              | Task management and a task's execution history on separate routes                                                                                                                |
| Databases          | Database management, backup copies and restoration on three separate routes                                                                                                      |
| Audit              | User/platform events and incoming GitHub webhook deliveries on separate pages                                                                                                    |

Project creation, resource lists and their editing confirmations retain one workflow per
resource. Searches and filters refine that workflow. Shared project navigation and contextual
links remain available without embedding another page's panels. Removed overview cards had
an equivalent complete destination; metrics, preview states and resource histories remain
reachable through the navigation.

New pages preserve existing authorization and explicit write confirmations. Task history
contains no execution control. Backup pages contain no restore action; restoration has its
own permission-gated page and still requires the environment key before confirmation. Merely
opening these pages, or cancelling a confirmation, does not enqueue an operation. Missing
or mismatched task, database and deployment URLs do not display another project's resource.

The review covers purpose boundaries as well as layout: browser assertions check that each
page renders its own headings and controls while unrelated panels remain absent. The browser
matrix uses 320 px and 1440 px, both themes and WCAG A/AA checks. Interaction checks cover
links, browser history destinations, cancelled imports/restores and developer/viewer access.
Native checks and a production build remain part of verification. Production infrastructure,
actual DNS changes, task execution and destructive restoration are outside this review.

## Follow-up: finding pages through navigation

- The global menu groups application status and projects under General, deployment history,
  activity and analysis under Deployments, and server management/metrics under Infrastructure.
  Full destination names appear in visible labels, accessible names and search. Pinned projects
  and the independent administration entry are preserved.
- Project destinations use Application, Publishing, Configuration and Data/Tasks menus.
  Administration uses Organization, Access/Audit, Infrastructure and Integrations. Each menu
  lists real links; navigation never executes an operation. On narrow screens one complete,
  grouped menu shows the selected page. Secondary settings and variable-import links wrap,
  keeping every destination visible rather than hiding links off the edge.
- A return link makes the full project list reachable from every project page. Task history
  now has a visible label, and eligible databases expose a direct restoration-page link in
  addition to backups. Existing permissions and destructive confirmations still apply.
- Command search includes the current project's pages, individual settings, import workflows
  and links for the active deployment, database or task. Current-resource destinations take
  priority over generic pages. Search matches words across project names, destination names
  and aliases, ignoring word order, case and accents. Restricted destinations remain absent.
- Navigation menus remain non-modal and support keyboard selection, Escape and focus return.
  Hovering a menu link does not preload another protected route. Browser back and unsaved-form
  cancellation keep the correct project and selected page.

Native tests cover route matching with segment boundaries, exact home pages, trailing slashes,
missing identifiers, command priority, route parameters, aliases and permission-specific
menus. Isolated browser checks exercise every project and administration destination, grouped
and collapsed global menus, keyboard search, browser back, unsaved changes and developer/viewer
access at 320, 768 and 1440 px in both themes. Open menus and search results are also checked
for overflow and WCAG A/AA accessibility. Navigation does not enqueue jobs in the test database.

## Follow-up: descriptive page names

Page names now identify their scope and purpose in menus, headings, browser titles and
command search. Application status, deployment history, recent deployments and resource
usage have distinct names. Project settings describe image construction, persistent storage,
application connectivity and the explicit move/delete operations. Provider connections,
outbound notifications and incoming GitHub webhooks have separate names.

Full destination names remain visible in the sidebar and search; longer labels wrap on
narrow screens. Existing URLs and permission checks remain unchanged. Former names such as
Build, Previews, Tasks and Volumes remain searchable as aliases for the new destinations.

## Follow-up: explicit action labels

Action labels now state the operation and its target. Publication, container restart,
container recreation without rebuilding, commit retry and republication of an existing image
have distinct names. Save controls identify the current form. Manual task saving, schedule
review and command execution use separate labels, with the existing schedule-review decision
shared by submission and its button text.

Opening restoration now says that a backup must be chosen. Its final action explicitly replaces
database data, and the confirmation identifies the database and backup timestamp. Deleting
databases, volumes, tasks, variables and tokens names the affected resource. Removing a server
explicitly removes it from the panel. Existing permissions, typed confirmations and callbacks
are preserved.

Editing and deletion controls have visible text. Log actions state that they copy or download
the displayed lines. Buttons and dialog footers support wrapped labels at narrow widths.
Isolated browser checks exercise form drafts and cancelled confirmations at 320 and 1440 px in
both themes, including accessibility and overflow checks. Reviewing and cancelling actions
must leave projects, tasks, databases and queued jobs unchanged. Real production operations
are outside this copy review.
