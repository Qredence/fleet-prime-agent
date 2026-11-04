
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
await pg.goto('file:///Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/compact.html');
await pg.waitForTimeout(300);
await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/c-top.png' });
await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/c-full.png', fullPage: true });
await pg.locator('#t').click();
await pg.waitForTimeout(200);
await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/c-dark.png', fullPage: true });
await b.close();
console.log('ok');
