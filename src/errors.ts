import * as z from 'zod/v4';

export class StudyError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

export function diagnostic(error: unknown) {
  if (error instanceof StudyError) {
    return { error: { code: error.code, message: error.message, details: error.details } };
  }
  if (error instanceof z.ZodError) {
    return { error: { code: 'invalid_request', message: 'Request does not match the operation contract', details: { issues: error.issues } } };
  }
  return { error: { code: 'internal_error', message: error instanceof Error ? error.message : String(error), details: {} } };
}
