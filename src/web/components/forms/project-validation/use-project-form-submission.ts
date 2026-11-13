import { useRef, useState } from "react";

import { toUserMessage } from "@/web/components/layout/error-message";

import type { ProjectFormApi } from "../project-form";

/** Keeps request failures with the draft and asks the summary to take focus after a failed submit. */
export function useProjectFormSubmission(form: ProjectFormApi, fallback: string) {
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const submitting = useRef(false);

  const submit = async () => {
    if (submitting.current || form.state.isSubmitting) {
      return;
    }

    submitting.current = true;
    try {
      // Values saved by another settings section may have changed since the last attempt.
      form.setErrorMap({ onSubmit: { fields: {} } });
      await form.validate("change");
      await form.handleSubmit();
      setFailure(null);
      if (form.state.isValid === false) {
        setFocusRequest((current) => current + 1);
      }
    } catch (error) {
      setFailure(toUserMessage(error, fallback));
      setFocusRequest((current) => current + 1);
    } finally {
      submitting.current = false;
    }
  };

  return { failure, focusRequest, submit, clearFailure: () => setFailure(null) };
}
