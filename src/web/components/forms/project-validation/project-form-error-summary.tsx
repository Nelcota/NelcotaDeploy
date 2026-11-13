import { useStore } from "@tanstack/react-form";
import { Link, useLocation } from "@tanstack/react-router";
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";

import type { ProjectSettingsFormSection } from "@/shared/schemas/settings/project-settings.schema";
import { projectSettingsDestination } from "@/web/components/project-settings/navigation/settings-destinations";
import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";

import { errorMessages } from "../form-field";
import type { ProjectFormApi } from "../project-form";
import { isProjectField, PROJECT_FORM_FIELDS } from "./project-form-fields-info";
import type { useProjectFormSubmission } from "./use-project-form-submission";

const FIELDS = Object.keys(PROJECT_FORM_FIELDS).filter(isProjectField);
const ERROR_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-sm py-2 text-sm font-medium break-words underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type SettingsContext = { readonly projectId: string; readonly section: ProjectSettingsFormSection };

function focusProjectField(form: HTMLFormElement, id: string) {
  const field = form.ownerDocument.getElementById(id);
  if (field == null || form.contains(field) === false) {
    return false;
  }

  let disclosure = field.closest("details");
  while (disclosure != null) {
    disclosure.open = true;
    disclosure = disclosure.parentElement?.closest("details") ?? null;
  }

  field.focus({ preventScroll: true });
  field.scrollIntoView({ block: "center" });
  return true;
}

/** Focuses a settings field reached by a link from another settings section. */
export function useSettingsFieldAnchor(form: RefObject<HTMLFormElement | null>) {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (form.current != null && FIELDS.some((name) => PROJECT_FORM_FIELDS[name].id === hash)) {
      focusProjectField(form.current, hash);
    }
  }, [form, hash]);
}

function FieldErrorLink({
  field,
  message,
  settings,
}: {
  readonly field: (typeof PROJECT_FORM_FIELDS)[keyof typeof PROJECT_FORM_FIELDS];
  readonly message: string;
  readonly settings: SettingsContext | undefined;
}) {
  const { id, label, section } = field;
  const destination =
    settings?.section === section ? undefined : projectSettingsDestination(section);
  if (settings != null && destination != null) {
    return (
      <Link
        to={destination.to}
        params={{ projectId: settings.projectId }}
        hash={id}
        target="_blank"
        rel="noopener"
        className={ERROR_LINK_CLASS}
      >
        {label}: {message} ({destination.label}, abre em outra aba)
      </Link>
    );
  }

  return (
    <a
      href={`#${id}`}
      className={ERROR_LINK_CLASS}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        const form = event.currentTarget.closest("form");
        if (form != null && focusProjectField(form, id)) {
          event.preventDefault();
        }
      }}
    >
      {label}: {message}
    </a>
  );
}

function useFocusErrorSummary(focusRequest: number) {
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusRequest === 0 || summary.current == null) {
      return;
    }

    const advanced = summary.current
      .closest("form")
      ?.querySelector<HTMLDetailsElement>("details[data-project-advanced]");
    if (advanced?.querySelector('[aria-invalid="true"]') != null) {
      advanced.open = true;
    }

    summary.current.focus({ preventScroll: true });
    summary.current.scrollIntoView({ block: "start" });
  }, [focusRequest]);
  return summary;
}

/** Lists validation errors after submit and keeps request failures visible until resolved. */
export function ProjectFormErrorSummary({
  form,
  submission,
  settings,
  retryDisabled = false,
}: {
  readonly form: ProjectFormApi;
  readonly submission: ReturnType<typeof useProjectFormSubmission>;
  readonly settings?: SettingsContext;
  readonly retryDisabled?: boolean;
}) {
  const { failure, focusRequest, submit } = submission;
  const [attempts, fieldMeta, isSubmitting] = useStore(
    form.store,
    (state) => [state.submissionAttempts, state.fieldMeta, state.isSubmitting] as const,
  );
  const summary = useFocusErrorSummary(focusRequest);
  const errors =
    attempts === 0
      ? []
      : FIELDS.flatMap((name) => {
          const [message] = errorMessages(fieldMeta[name]?.errors ?? []);
          return message == null ? [] : [{ field: PROJECT_FORM_FIELDS[name], message }];
        });
  const hasFieldErrors = errors.length > 0;

  if (hasFieldErrors === false && failure == null) {
    return null;
  }

  return (
    <ErrorSummaryPanel
      summary={summary}
      heading={settings == null ? "h2" : "h3"}
      title={hasFieldErrors ? "Confira os campos com erro" : "Não foi possível enviar o formulário"}
      failure={failure}
    >
      {hasFieldErrors ? (
        <ul className="mt-1 divide-y divide-border">
          {errors.map(({ field, message }) => (
            <li key={field.id}>
              <FieldErrorLink field={field} message={message} settings={settings} />
            </li>
          ))}
        </ul>
      ) : null}
      {failure == null ? null : (
        <RetryButton disabled={retryDisabled} submitting={isSubmitting} onRetry={submit} />
      )}
    </ErrorSummaryPanel>
  );
}

function RetryButton({
  disabled,
  submitting,
  onRetry,
}: {
  readonly disabled: boolean;
  readonly submitting: boolean;
  readonly onRetry: () => Promise<void>;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="mt-3 min-h-11 w-full sm:w-auto"
      disabled={disabled || submitting}
      onClick={() => void onRetry()}
    >
      {submitting ? "Enviando…" : "Tentar novamente"}
    </Button>
  );
}

function ErrorSummaryPanel({
  summary,
  heading: Heading,
  title,
  failure,
  children,
}: {
  readonly summary: RefObject<HTMLElement | null>;
  readonly heading: "h2" | "h3";
  readonly title: string;
  readonly failure: string | null;
  readonly children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      ref={summary}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cn(
        "scroll-mt-4 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        Heading === "h3" && "scroll-mt-20 @min-[52rem]/settings:scroll-mt-4",
      )}
    >
      <div role="alert">
        <Heading id={titleId} className="text-base font-semibold">
          {title}
        </Heading>
        {failure == null ? null : <p className="mt-2 text-sm">{failure}</p>}
      </div>
      {children}
    </section>
  );
}
