import { chromium } from 'playwright';
import * as https from 'https';

async function testSearx(query: string): Promise<void> {
  const instances = [
    'https://search.bus-hit.me/search?q=',
    'https://searx.be/search?q=',
  ];
  for (const base of instances) {
    const url = `${base}${encodeURIComponent(query)}&format=json`;
    console.log('\n[searx]', base);
    try {
      const body = await new Promise<string>((resolve, reject) => {
        https.get(url, { headers: { Accept: 'application/json' }, timeout: 12000 }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          res.on('error', reject);
        }).on('error', reject);
      });
      const data = JSON.parse(body) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      console.log('hits', data.results?.length ?? 0);
      data.results?.slice(0, 2).forEach((r) => {
        console.log(' ', r.title?.slice(0, 60), '|', r.url?.slice(0, 70));
      });
      if ((data.results?.length ?? 0) > 0) return;
    } catch (e: unknown) {
      console.log('fail', e instanceof Error ? e.message : e);
    }
  }
}

async function testPlaywrightDdg(query: string): Promise<void> {
  console.log('\n[playwright ddg]', query);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    const hasCaptcha = /bots use DuckDuckGo|complete the following challenge/i.test(text);
    const links = await page.$$eval('a.result__a', (els) =>
      els.slice(0, 3).map((a) => ({ title: a.textContent?.trim(), href: (a as HTMLAnchorElement).href })),
    );
    console.log('captcha', hasCaptcha, 'links', links.length);
    links.forEach((l) => console.log(' ', l.title?.slice(0, 60), '|', l.href?.slice(0, 80)));
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const q = 'digital minimalism ebook gumroad';
  await testSearx(q);
  await testPlaywrightDdg(q);
}

main().catch(console.error);
