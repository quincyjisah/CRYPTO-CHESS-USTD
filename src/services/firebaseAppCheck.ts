export interface AppCheckContext {
  appId: string;
  token?: string;
}

export function assertAppCheckToken(context: AppCheckContext): void {
  if (!context.token || context.token.length < 20) {
    throw new Error("Missing or invalid Firebase App Check token.");
  }
}
