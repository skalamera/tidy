import type { TidyApi } from '../shared/ipc';

declare global {
  interface Window {
    tidy: TidyApi;
  }
}

export {};
