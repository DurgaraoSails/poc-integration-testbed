import { APP_BASE_HREF } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer } from '@angular/core';
import { PocBridge, providePocBridge } from '@yateesha-pappala/poc-bridge/poc';

import { scopedPocBridgeInterceptor } from './core/poc-api';
import { PocTheme } from './core/poc-theme';
import { runtimeConfig } from './core/runtime-config';

/**
 * `portalOrigin` is validated by `main.ts` before this runs, so it is a bare origin by the time
 * `providePocBridge` sees it (which throws on anything else, including '*').
 */
export function appConfig(portalOrigin: string): ApplicationConfig {
  return {
    providers: [
      { provide: APP_BASE_HREF, useValue: runtimeConfig.basePath || '/' },

      providePocBridge({ portalOrigin }),

      provideHttpClient(withInterceptors([scopedPocBridgeInterceptor])),

      // Blocks bootstrap until the handshake settles, so no component can fire a request before a
      // token exists. Note this resolves on terminal failures too — components still gate on
      // `status() === 'ready'`, never on this having resolved (guide §6).
      provideAppInitializer(() => inject(PocBridge).waitForSession()),

      // Instantiated eagerly: its effect is what applies the portal's theme, and nothing else
      // injects it.
      provideAppInitializer(() => void inject(PocTheme)),
    ],
  };
}
