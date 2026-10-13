import type { TidyApi } from '../../shared/ipc';

/** The preload bridge. A function (not a constant) so tests can install a fake window.tidy before rendering. */
export const tidy = (): TidyApi => window.tidy;
