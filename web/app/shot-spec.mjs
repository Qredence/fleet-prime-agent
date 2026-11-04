
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1180, height: 1100 }, deviceScaleFactor: 1 });
await pg.goto('file:///Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/specimen.html');
await pg.waitForTimeout(250);
await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/s-full.png', fullPage: true });
await pg.locator('#t').click();
await pg.waitForTimeout(150);
await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/s-dark.png', fullPage: true });
await b.close();
console.log('ok');
