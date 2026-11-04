
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 700, height: 1200 }, deviceScaleFactor: 1 });
await pg.goto('file:///Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/compact.html');
await pg.waitForTimeout(250);
await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/c-mobile.png', fullPage: true });
await b.close();
console.log('ok');
