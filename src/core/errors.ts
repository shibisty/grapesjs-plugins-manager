/** Error codes the UI translates (see `PluginsManagerLabels.err*`). */
export type PluginsManagerErrorCode =
  | 'notZip'
  | 'noJs'
  | 'noId'
  | 'tooLarge'
  | 'notRegistered'
  | 'conflict'
  | 'script'
  | 'storage';

export class PluginsManagerError extends Error {
  readonly code: PluginsManagerErrorCode;
  /** Underlying cause (e.g. the SyntaxError thrown by the plugin bundle). */
  readonly detail?: string;

  constructor(code: PluginsManagerErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'PluginsManagerError';
    this.code = code;
    this.detail = detail;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Message plus the underlying cause, for the plugin list. */
export function fullMessage(e: unknown): string {
  return e instanceof PluginsManagerError && e.detail ? `${e.message}: ${e.detail}` : errorMessage(e);
}
