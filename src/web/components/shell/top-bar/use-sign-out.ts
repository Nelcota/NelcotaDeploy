import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/web/components/shell/auth-client";

/** Signs the user out and opens the login page; a failure shows a toast. */
export function useSignOut() {
  const router = useRouter();
  return async () => {
    const result = await authClient.signOut();
    if (result.error != null) {
      toast.error("Não foi possível sair. Tente novamente.");
      return;
    }
    await router.navigate({ to: "/login" });
  };
}
