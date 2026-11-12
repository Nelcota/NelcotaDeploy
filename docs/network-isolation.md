# Network isolation rollout

The panel Compose stack puts the web process on `nelcota-control`. Traefik reaches it at the configured address. Traefik serves its own routes and the worker's application routes through the file provider. The worker keeps the Docker socket. The existing `nelcota` bridge remains available to legacy workloads during migration.

## Prepare the panel host

1. Confirm that `PANEL_CONTROL_SUBNET` is free on the panel host and that `PANEL_CONTROL_ADDRESS` belongs to that subnet. The defaults are `172.29.240.0/24` and `172.29.240.10`. Set both together if the host already uses the default subnet.
2. Back up the database, route files and Traefik certificates. Confirm that running applications on local and SSH hosts have their route files before upgrading from an older label-based proxy. Re-deploy any application that depends on the old label-based routes before switching to the file-only proxy.
3. Recreate the panel services through the repository's Compose stack. Check the HTTP redirect, HTTPS panel route, authentication and an existing application route. Existing remote proxies are recreated on the next server check and can interrupt traffic briefly.

## Migrate a project

1. Add one project UUID to `ISOLATED_PROJECT_IDS` in the worker environment and restart the worker. Leave the value empty to keep using the shared workload bridge. Select a project with a working rollback image and confirm its target server is ready.
2. Redeploy it. The worker creates the project's bridge, reconnects its managed databases to it and attaches the trusted proxy and, on the local Compose host, the worker that runs health checks. Existing databases keep their legacy attachment during migration.
3. Confirm the project's routed endpoints, database connections, probes and preview routes. Check an SSH-hosted project in a separate canary before expanding. For Compose workloads, use service names outside the reserved `nelcota-` prefix and build with the default or no network.
4. Once the legacy version has drained and the project no longer needs immediate rollback, disconnect that project's database containers from the legacy bridge. Check the application again before adding another UUID. Repeat for the remaining projects.

## Roll back a project

Before returning a project to the legacy bridge, attach its database containers to that bridge and confirm the expected database hostnames resolve there. Remove the project UUID from the worker's setting, restart the worker and redeploy the previous working revision. Confirm the new deployment is healthy and serving before removing any unused bridge. Deleting a project removes its managed bridge after its workloads are gone.

The isolation canary applies to new containers. An app can still reach public ingress, including the authenticated panel route, through Traefik. Direct access to the panel's private address and another project's bridge is restricted by the Docker network boundary.
