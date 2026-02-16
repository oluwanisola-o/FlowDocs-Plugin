/// <reference types="vite/client" />

import type { ConfigEnv } from 'vite';

declare module 'vite' {
  export interface ConfigEnv {
    context?: 'ui' | 'main';
  }
}
