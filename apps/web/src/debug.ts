type Details = Record<string, boolean | number | string | undefined>;

const enabled = import.meta.env.DEV || import.meta.env.VITE_DEBUG === "true";

export function debug(event: string, details: Details = {}): void {
  if (enabled) console.debug(`[spm] ${event}`, details);
}

export function debugError(
  event: string,
  error: unknown,
  details: Details = {},
): void {
  if (!enabled) return;
  const exception = error instanceof Error ? error : undefined;
  console.error(`[spm] ${event}`, {
    ...details,
    errorName: exception?.name ?? "UnknownError",
    errorMessage: exception?.message ?? String(error),
  });
}
