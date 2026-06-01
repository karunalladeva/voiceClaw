import { chromium } from 'playwright';
import * as https from 'https';

async function testDdgLite(query: string): Promise<void> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  console.log('\n[ddg lite http]', query);
  const html = await new Promise<string>((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
      timeout: 15000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
  console.log('htmlLen', html.length, 'captcha', /bots use DuckDuckGo|anomaly-modal/i.test(html));
  const linkRe = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && n < 5) {
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    if (title.length > 5 && !title.includes('Next') && !title.includes('Previous')) {
      n++;
      console.log(n, title.slice(0, 70), m[1].slice(0, 80));
    }
  }
}

async function testBingEnUs(query: string): Promise<void> {
  console.log('\n[bing en-us playwright]', query);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&cc=US`,
      { waitUntil: 'domcontentloaded', timeout: 20000 },
    );
    const hits = await page.evaluate(() =>
      Array.from(document.querySelectorAll('li.b_algo')).slice(0, 5).map((li) => {
        const a = li.querySelector('h2 a');
        const p = li.querySelector('.b_caption p, p');
        return {
          title: a?.textContent?.trim() ?? '',
          url: (a as HTMLAnchorElement | null)?.href ?? '',
          snippet: p?.textContent?.trim()?.slice(0, 100) ?? '',
        };
      }),
    );
    console.log('hits', hits.length);
    hits.forEach((h) => console.log(JSON.stringify(h)));
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const q = 'digital minimalism ebook gumroad';
  await testDdgLite(q);
  await testBingEnUs(q);
  await testBingEnUs('amazon kindle digital minimalism bestseller');
}

main().catch(console.error);
