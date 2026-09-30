/** The message of whatever was thrown, for a journal entry. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
