import { APP_BASE_HREF } from '@angular/common';
import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { sailsConfig } from './app/sails';

bootstrapApplication(App, {
  providers: [
    // The router needs the deployed prefix too, not just <base href>.
    { provide: APP_BASE_HREF, useValue: sailsConfig.basePath || '/' },
  ],
}).catch((err) => console.error(err));
