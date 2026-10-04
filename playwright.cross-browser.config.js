import config from './playwright.config.js';
import {devices} from '@playwright/test';
export default {...config,projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}]};
