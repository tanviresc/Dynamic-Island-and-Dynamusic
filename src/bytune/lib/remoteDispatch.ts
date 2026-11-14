/** Dependency-free dispatcher slot so player.ts and mobileMode.ts stay acyclic. */
export type RemoteDispatchFn = (command: string, payload?: unknown) => void;

let remoteDispatch: RemoteDispatchFn | null = null;

export function registerRemoteCommandDispatcher(fn: RemoteDispatchFn): void {
  remoteDispatch = fn;
}

export function getRemoteCommandDispatcher(): RemoteDispatchFn | null {
  return remoteDispatch;
}

