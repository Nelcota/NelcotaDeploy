type HttpsObservation = {
  readonly up: boolean;
  readonly checkedAt: string;
  readonly reason: string | null;
};

/** Finds the first successful check after the most recent outage involving a certificate. */
export function httpsRecoveryAt(recent: readonly HttpsObservation[]): string | null {
  const lastFailure = recent.findLastIndex((check) => check.up === false);
  const recovered = recent.at(lastFailure + 1);
  if (lastFailure < 0 || recovered?.up !== true) {
    return null;
  }

  const previousSuccess = recent.findLastIndex((check, index) => index < lastFailure && check.up);
  const outage = recent.slice(previousSuccess + 1, lastFailure + 1);
  return outage.some((check) => check.reason === "certificate") ? recovered.checkedAt : null;
}
