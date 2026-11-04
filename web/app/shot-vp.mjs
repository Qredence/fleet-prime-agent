
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await pg.goto('file:///Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/index.html');
await pg.waitForTimeout(300);
const spots = [0, 900, 1900, 2900, 3900, 4900, 5900, 6900, 7900, 8900, 9900];
for (let i=0;i<spots.length;i++){
  await pg.evaluate(y=>window.scrollTo(0,y), spots[i]);
  await pg.waitForTimeout(150);
  await pg.screenshot({ path: '/Volumes/SSD-T7/qredence-environnement/playground/fleet-design-system/vp-'+i+'.png' });
}
await b.close();
console.log('ok');
