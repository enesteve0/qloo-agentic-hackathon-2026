import 'server-only';

/**
 * An error whose message was written for people and is safe to show. Anything else (upstream errors,
 * stack traces, URLs that might carry tokens) is replaced by a generic sentence before it reaches the UI.
 */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code: 'anchors' | 'no_signal' | 'qloo_quota' | 'qloo_unavailable' | 'qloo_busy' | 'deadline' | 'other' = 'other',
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export const GENERIC_ERROR = 'Something went wrong while planning. Try again, or open a recorded plan.';

export function toUserMessage(err: unknown, aborted: boolean): string {
  if (err instanceof UserFacingError) return err.message;
  if (aborted) return 'The run hit its time limit. Try again, or open a recorded plan.';
  return GENERIC_ERROR;
}
