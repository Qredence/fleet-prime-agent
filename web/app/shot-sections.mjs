
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await pg.goto('file:///Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/index.html');
await pg.waitForTimeout(300);
const ids = ['overview','principles','color','type','space','actions','forms','feedback','surfaces','content','patterns','governance'];
for (const id of ids) {
  const el = pg.locator('#'+id);
  await el.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/sec-'+id+'.png' });
}
await b.close();
console.log('done');
