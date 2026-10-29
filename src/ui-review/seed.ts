// Fills a throwaway database with a realistic panel, so every screen has something to show.
// Run by main.ts in a child process whose DATABASE_PATH points at a temporary file.
import { createUser, getAuth } from "@/auth";
import { getDatabase, migrateDatabase, tables } from "@/db";
import { completeDeployment, requestDeployment, transitionDeployment } from "@/deployments";
import { addDomain } from "@/domains";
import { saveEnvironmentVariable } from "@/environments";
import { createProject } from "@/projects";
import { getSecretBox } from "@/secrets";
import { saveSystemSettings } from "@/settings";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createTask } from "@/tasks";

import { seedServers } from "./seed-servers";

const ACTOR = { type: "system", label: "ui-review" } as const;
const MINUTE_IN_MS = 60_000;
const METRIC_SAMPLES = 60;
const BYTES_PER_KIBIBYTE = 1024;
const MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const REVIEW_DURATION_IN_MINUTES = 60;
const REVIEW_DURATION_IN_MS = REVIEW_DURATION_IN_MINUTES * MINUTE_IN_MS;
const SHORT_COMMIT_LENGTH = 7;
const CONTAINER_UPTIME_IN_MINUTES = 90;

const email = process.env["UI_REVIEW_EMAIL"] ?? "";
const password = process.env["UI_REVIEW_PASSWORD"] ?? "";
if (email === "" || password === "") {
  throw new Error("UI_REVIEW_EMAIL and UI_REVIEW_PASSWORD must be set");
}

const database = getDatabase();
migrateDatabase(database);
const secretBox = await getSecretBox();
const now = Date.now();

await createUser(getAuth(), database, {
  newUser: { email, name: "Ana Revisora", role: "admin", password },
  actor: ACTOR,
});
saveSystemSettings(database, {
  organizationName: "Nelcota",
  baseDomain: "apps.exemplo.com",
  httpsByDefault: true,
});

const api = createProject(
  database,
  {
    name: "API de pagamentos",
    slug: "api-pagamentos",
    repositoryUrl: "https://github.com/nelcota/api-pagamentos",
    branch: "main",
    dockerfilePath: "Dockerfile",
    buildContext: ".",
    internalPort: 3000,
    healthCheckPath: "/health",
    autoDeploy: true,
  },
  { actor: ACTOR, userId: null, isAdmin: true },
);
createProject(
  database,
  {
    name: "Site institucional com um nome bem comprido para testar quebras",
    slug: "site-institucional",
    repositoryUrl: "https://github.com/nelcota/site-institucional",
    branch: "feature/nova-pagina-inicial-com-branch-longa",
    dockerfilePath: "Dockerfile",
    buildContext: ".",
    internalPort: 8080,
    healthCheckPath: null,
    autoDeploy: false,
  },
  { actor: ACTOR, userId: null, isAdmin: false },
);

function runDeploy(outcome: "succeeded" | "failed", commit: string, message: string): string {
  const { deploymentId } = requestDeployment(database, {
    projectId: api.id,
    trigger: "manual",
    actor: ACTOR,
    triggeredByUserId: null,
  });
  transitionDeployment(database, deploymentId, {
    to: "cloning",
    commitSha: commit,
    commitMessage: message,
  });
  transitionDeployment(database, deploymentId, { to: "building" });
  if (outcome === "failed") {
    transitionDeployment(database, deploymentId, {
      to: "failed",
      errorMessage: "docker build failed: npm ERR! missing script: build",
    });
    return deploymentId;
  }
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: `nelcota/api-pagamentos:${commit.slice(0, SHORT_COMMIT_LENGTH)}`,
    containerName: `nelcota-api-pagamentos-${commit.slice(0, SHORT_COMMIT_LENGTH)}`,
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  return deploymentId;
}

runDeploy("succeeded", "1a2b3c4d5e6f7a8b9c0d", "feat: primeira versão da API");
runDeploy("failed", "2b3c4d5e6f7a8b9c0d1e", "fix: corrige o cálculo de juros");
const liveDeploymentId = runDeploy(
  "succeeded",
  "3c4d5e6f7a8b9c0d1e2f",
  "feat(pagamentos): adiciona Pix com QR code dinâmico e conciliação automática",
);

const ENVIRONMENT_VARIABLES = [
  ["NODE_ENV", "plain", "production"],
  ["API_BASE_URL", "plain", "https://api.exemplo.com"],
  ["DATABASE_URL", "secret", "postgres://usuario:senha@db:5432/pagamentos"],
] as const;
await Promise.all(
  ENVIRONMENT_VARIABLES.map(
    async ([key, kind, value]) =>
      await saveEnvironmentVariable(database, secretBox, {
        projectId: api.id,
        input: { key, kind, value, availableAtBuild: key === "NODE_ENV" },
        actor: ACTOR,
      }),
  ),
);
addDomain(database, {
  projectId: api.id,
  input: { hostname: "pagamentos.exemplo.com", httpsEnabled: true },
  actor: ACTOR,
});

const taskContext = { actor: ACTOR, userId: null, timeZone: "America/Sao_Paulo" };
createTask(database, {
  projectId: api.id,
  input: taskInputSchema.parse({
    name: "Migrar banco",
    commandLine: "bun run db:migrate",
    schedule: "",
    enabled: true,
    timeoutInSeconds: 300,
  }),
  ...taskContext,
});
createTask(database, {
  projectId: api.id,
  input: taskInputSchema.parse({
    name: "Limpar cache",
    commandLine: "bun run cache:clear --all",
    schedule: "0 3 * * *",
    enabled: false,
    timeoutInSeconds: 60,
  }),
  ...taskContext,
});

const startedAt = new Date(now - CONTAINER_UPTIME_IN_MINUTES * MINUTE_IN_MS).toISOString();
database
  .insert(tables.containerSnapshots)
  .values({
    containerId: "container-api",
    projectId: api.id,
    deploymentId: liveDeploymentId,
    name: "nelcota-api-pagamentos-3c4d5e6",
    image: "nelcota/api-pagamentos:3c4d5e6",
    state: "running",
    health: "healthy",
    restartCount: 1,
    startedAt,
    observedAt: new Date(now).toISOString(),
  })
  .run();
database
  .insert(tables.workerHeartbeats)
  .values({
    workerId: "ui-review",
    startedAt,
    // Dated ahead so the worker still counts as online while the review takes its screenshots.
    lastSeenAt: new Date(now + REVIEW_DURATION_IN_MS).toISOString(),
    dockerAvailable: true,
    dockerVersion: "28.0.0",
  })
  .run();
// Each fake metric curve is a base value plus a sine wave of the given amplitude.
const WAVE_PERIOD_IN_SAMPLES = 6;
const CONTAINER_METRICS = {
  cpu: { basePercent: 12, amplitudePercent: 8 },
  memory: { baseInMebibytes: 180, amplitudeInMebibytes: 20, totalInMebibytes: 2048 },
} as const;
const HOST_METRICS = {
  cpu: { basePercent: 30, amplitudePercent: 15 },
  memory: { baseInMebibytes: 2600, amplitudeInMebibytes: 200, totalInMebibytes: 8192 },
  disk: { usedInMebibytes: 40_000, totalInMebibytes: 80_000 },
} as const;

for (let index = 0; index < METRIC_SAMPLES; index += 1) {
  const createdAt = new Date(now - (METRIC_SAMPLES - index) * MINUTE_IN_MS).toISOString();
  const wave = Math.sin(index / WAVE_PERIOD_IN_SAMPLES);
  const { cpu: containerCpu, memory: containerMemory } = CONTAINER_METRICS;
  const { cpu: hostCpu, memory: hostMemory, disk: hostDisk } = HOST_METRICS;
  database
    .insert(tables.metricSamples)
    .values([
      {
        scope: "container",
        projectId: api.id,
        cpuPercent: containerCpu.basePercent + wave * containerCpu.amplitudePercent,
        memoryUsedBytes: Math.round(
          (containerMemory.baseInMebibytes + wave * containerMemory.amplitudeInMebibytes) *
            MEBIBYTE,
        ),
        memoryTotalBytes: containerMemory.totalInMebibytes * MEBIBYTE,
        createdAt,
      },
      {
        scope: "host",
        projectId: null,
        cpuPercent: hostCpu.basePercent + wave * hostCpu.amplitudePercent,
        memoryUsedBytes: Math.round(
          (hostMemory.baseInMebibytes + wave * hostMemory.amplitudeInMebibytes) * MEBIBYTE,
        ),
        memoryTotalBytes: hostMemory.totalInMebibytes * MEBIBYTE,
        diskUsedBytes: hostDisk.usedInMebibytes * MEBIBYTE,
        diskTotalBytes: hostDisk.totalInMebibytes * MEBIBYTE,
        createdAt,
      },
    ])
    .run();
}

const RUNTIME_LOG_LINES = [
  ["stdout", "Server listening on http://0.0.0.0:3000"],
  ["stdout", "Connected to postgres at db:5432 (pool size 10)"],
  ["stdout", "GET /health 200 2ms"],
  ["stdout", "POST /pagamentos/pix 201 84ms"],
  ["stderr", "warning: PIX_WEBHOOK_URL not set, notifications disabled"],
  ["stdout", "GET /pagamentos/3f9a 200 12ms"],
  ["stderr", "Error: connection refused while calling https://api.banco.exemplo.com/cobrancas"],
  ["stdout", "Retrying request to api.banco.exemplo.com (attempt 2 of 3)"],
  ["stdout", "POST /pagamentos/pix 201 91ms"],
  ["stdout", "GET /health 200 1ms"],
] as const;
const LOG_LINE_SPACING_IN_MS = 7000;
database
  .insert(tables.runtimeLogs)
  .values(
    RUNTIME_LOG_LINES.map(([stream, message], index) => ({
      projectId: api.id,
      deploymentId: liveDeploymentId,
      stream,
      message,
      createdAt: new Date(
        now - (RUNTIME_LOG_LINES.length - index) * LOG_LINE_SPACING_IN_MS,
      ).toISOString(),
    })),
  )
  .run();

await seedServers(database, secretBox);

// The last line is read by main.ts to know which pages to open.
process.stdout.write(`${JSON.stringify({ projectId: api.id, deploymentId: liveDeploymentId })}\n`);
