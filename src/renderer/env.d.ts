import type { LocalTranslateApi } from '../preload/index';

declare global {
  interface Window {
    localTranslate: LocalTranslateApi;
  }
}

export {};
