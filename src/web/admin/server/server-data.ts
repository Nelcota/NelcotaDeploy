import type { useSettings } from "../use-settings";

/** Server state reported with the settings. */
export type ServerData = NonNullable<ReturnType<typeof useSettings>["data"]>["server"];
