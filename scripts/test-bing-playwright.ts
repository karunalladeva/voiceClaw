import { chromium } from 'playwright';

async function testBingPlaywright(query: string): Promise<void> {
  console.log('\n[bing playwright]', query);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    const hits = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('li.b_algo')).slice(0, 5);
      return items.map((li) => {
        const a = li.querySelector('h2 a');
        const p = li.querySelector('.b_caption p, p');
        return {
          title: a?.textContent?.trim() ?? '',
          url: (a as HTMLAnchorElement | null)?.href ?? '',
          snippet: p?.textContent?.trim()?.slice(0, 120) ?? '',
        };
      });
    });
    console.log('hits', hits.length);
    hits.forEach((h) => console.log(JSON.stringify(h)));
    if (hits.length === 0) {
      const preview = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '');
      console.log('bodyPreview', preview);
    }
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  await testBingPlaywright('digital minimalism ebook gumroad');
  await testBingPlaywright('site:amazon.com kindle digital minimalism bestseller');
}

main().catch(console.error);
