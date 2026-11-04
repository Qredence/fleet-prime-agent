
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await pg.goto('file:///Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/index.html');
await pg.waitForTimeout(300);
await pg.locator('#motion').screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/sec-motion2.png' });
await pg.locator('#themeToggle').click();
await pg.waitForTimeout(300);
await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/dark-top.png' });
await pg.locator('#actions').screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/dark-actions.png' });
await pg.locator('#patterns').screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/dark-patterns.png' });
await b.close();
console.log('ok');
