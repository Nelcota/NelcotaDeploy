import type { listProjectsFn } from "@/web/functions/projects.functions";

export type ProjectRow = Awaited<ReturnType<typeof listProjectsFn>>[number];

export const STATUS_FILTERS = {
  all: "Todos",
  online: "Online",
  offline: "Precisam de atenção",
  never: "Sem deploy",
  pending: "Aguardando aprovação",
} as const;

export type StatusFilter = keyof typeof STATUS_FILTERS;

export const STATUS_FILTER_VALUES = [
  "all",
  "online",
  "offline",
  "never",
  "pending",
] as const satisfies readonly StatusFilter[];

/**
 * Narrows a select value to a known status filter.
 *
 * @param value - Value chosen in the filter select.
 * @returns True when it names one of {@link STATUS_FILTERS}.
 */
export function isStatusFilter(value: string): value is StatusFilter {
  return Object.hasOwn(STATUS_FILTERS, value);
}

type SortKey = "name" | "latestDeployment";
type SortState = { readonly key: SortKey; readonly direction: "ascending" | "descending" };

export const SORT_OPTIONS = {
  "name-ascending": { label: "Nome (A–Z)", key: "name", direction: "ascending" },
  "name-descending": { label: "Nome (Z–A)", key: "name", direction: "descending" },
  "latestDeployment-descending": {
    label: "Deploy mais recente",
    key: "latestDeployment",
    direction: "descending",
  },
  "latestDeployment-ascending": {
    label: "Deploy mais antigo",
    key: "latestDeployment",
    direction: "ascending",
  },
} as const satisfies Record<string, SortState & { readonly label: string }>;

export type SortOption = keyof typeof SORT_OPTIONS;

/**
 * Narrows a select value to a known sort option.
 *
 * @param value - Value chosen in the sort select.
 * @returns True when it names one of {@link SORT_OPTIONS}.
 */
export function isSortOption(value: string): value is SortOption {
  return Object.hasOwn(SORT_OPTIONS, value);
}

type SortableProject = {
  readonly name: string;
  readonly latestDeployment: { readonly createdAt: string } | null;
};

/**
 * Orders projects by name or by the time of their latest deployment.
 *
 * @remarks Projects never deployed go last in both directions.
 *
 * @param projects - Projects to order; the array is not changed.
 * @param sort - Key and direction.
 * @returns A new, sorted array.
 */
export function sortProjects<Project extends SortableProject>(
  projects: readonly Project[],
  sort: SortState,
): Project[] {
  const sign = sort.direction === "ascending" ? 1 : -1;
  return projects.toSorted((left, right) => {
    if (sort.key === "name") {
      return sign * left.name.localeCompare(right.name, "pt-BR");
    }
    const leftTime = left.latestDeployment?.createdAt ?? null;
    const rightTime = right.latestDeployment?.createdAt ?? null;
    if (leftTime == null || rightTime == null) {
      return Number(leftTime == null) - Number(rightTime == null);
    }
    return sign * leftTime.localeCompare(rightTime);
  });
}
