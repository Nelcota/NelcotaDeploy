import { useRouter } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";

const COPY_COMMAND = "--copy-project-link";
const COPIED_FEEDBACK_IN_MS = 4000;

type CopyFeedback = { readonly copied: true } | { readonly copied: false; readonly url: string };

function useCopyCommand(copy: () => Promise<void>) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if ("CommandEvent" in window === false) {
      return undefined;
    }

    const element = target.current;
    const onCommand = (event: Event) => {
      if ("command" in event && event.command === COPY_COMMAND) {
        void copy();
      }
    };
    element?.addEventListener("command", onCommand);
    return () => element?.removeEventListener("command", onCommand);
  }, [copy]);
  return target;
}

function useProjectLinkClipboard(projectId: string) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const copy = useCallback(async () => {
    const { publicHref } = router.buildLocation({
      to: "/projects/$projectId",
      params: { projectId },
    });
    const url = new URL(publicHref, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setFeedback({ copied: true });
    } catch (error) {
      console.error("Could not copy the project link", error);
      setFeedback({ copied: false, url });
    }
  }, [projectId, router]);

  useEffect(() => {
    if (feedback?.copied !== true) {
      return undefined;
    }

    const timer = setTimeout(() => setFeedback(null), COPIED_FEEDBACK_IN_MS);
    return () => clearTimeout(timer);
  }, [feedback]);
  return { copy, feedback };
}

/** Copies the project overview URL and offers a selectable link when clipboard access fails. */
export function CopyProjectLink({ projectId }: { readonly projectId: string }) {
  const targetId = useId();
  const { copy, feedback } = useProjectLinkClipboard(projectId);
  const target = useCopyCommand(copy);

  return (
    <div id={targetId} ref={target} className="min-w-0 space-y-2">
      <Button
        {...{ command: COPY_COMMAND, commandfor: targetId }}
        type="button"
        variant="outline"
        className="min-h-11 w-full sm:w-auto"
        onClick={() => {
          if ("CommandEvent" in window === false) {
            void copy();
          }
        }}
      >
        {feedback?.copied === true ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        Copiar link do projeto
      </Button>
      <p role="status" className="text-sm text-muted-foreground empty:sr-only">
        {feedback?.copied === true ? "Link copiado." : null}
        {feedback?.copied === false
          ? "Não foi possível copiar. Copie o link abaixo manualmente."
          : null}
      </p>
      {feedback?.copied === false ? (
        <Input
          aria-label="Link do projeto para copiar manualmente"
          readOnly
          value={feedback.url}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}
