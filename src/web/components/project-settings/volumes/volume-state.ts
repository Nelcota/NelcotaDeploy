/** Fields of a volume that decide what the interface shows and allows. */
type VolumeFields = {
  readonly attached: boolean;
  readonly deletionRequestedAt: string | null;
  readonly deletionError: string | null;
};

/** What a volume row shows: a tag, the actions it offers and a note after a failed deletion. */
export type VolumeState = {
  readonly label: string;
  readonly tone: "neutral" | "warning" | "success";
  readonly canToggle: boolean;
  readonly canDeleteData: boolean;
  readonly failureNote: string | null;
};

/**
 * Describes a volume for its row in the project settings.
 *
 * @param volume - Whether it is attached and the state of its data deletion.
 * @returns The tag, the allowed actions and an explanation when the last deletion failed.
 */
export function volumeState(volume: VolumeFields): VolumeState {
  if (volume.deletionRequestedAt != null) {
    return {
      label: "Apagando dados…",
      tone: "warning",
      canToggle: false,
      canDeleteData: false,
      failureNote: null,
    };
  }
  // The stored reason is for the logs; people get a message they can act on.
  const failureNote =
    volume.deletionError == null
      ? null
      : "Não foi possível apagar os dados. Aplique as mudanças para o contêiner deixar de usar o volume e tente de novo.";
  if (volume.attached) {
    return {
      label: "Montado",
      tone: "success",
      canToggle: true,
      canDeleteData: false,
      failureNote,
    };
  }
  return {
    label: "Desanexado",
    tone: "neutral",
    canToggle: true,
    canDeleteData: true,
    failureNote,
  };
}
