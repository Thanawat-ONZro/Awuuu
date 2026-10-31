import { DEFAULT_SETTINGS, type Settings } from "./state";

/** Keep the old implicit defaults for existing installs that have not saved a module choice. */
export function resolveModuleSettings(saved: Pick<Settings, "onboarded" | "modules"> | null | undefined): Record<string, boolean> {
  return {
    ...DEFAULT_SETTINGS.modules,
    ...(saved?.onboarded ? { calendar: true, translation: true } : {}),
    ...(saved?.modules ?? {}),
  };
}
