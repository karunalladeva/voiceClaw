import * as https from 'https';

function fetchHtml(url: string): Promise<{ status: number; html: string }> {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, html: Buffer.concat(chunks).toString('utf-8') }));
        res.on('error', reject);
      },
    ).on('error', reject);
  });
}

async function testBing(query: string): Promise<void> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=5`;
  console.log('\n[bing]', query);
  const { status, html } = await fetchHtml(url);
  console.log('status', status, 'htmlLen', html.length);
  const liRe = /<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?(?:<p>([\s\S]*?)<\/p>)?/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = liRe.exec(html)) !== null && n < 3) {
    n++;
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const snippet = (m[3] ?? '').replace(/<[^>]+>/g, '').trim();
    console.log(` ${n}.`, title.slice(0, 70));
    console.log('   ', m[1].slice(0, 90));
    console.log('   ', snippet.slice(0, 100));
  }
  console.log('parsed', n);
}

async function testGooglethisRaw(query: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const google = require('googlethis');
  console.log('\n[googlethis raw]', query);
  const r = await google.search(query, { page: 0, safe: false });
  console.log('keys', Object.keys(r));
  console.log('resultsLen', r.results?.length);
  if (r.results?.[0]) console.log('first', JSON.stringify(r.results[0]).slice(0, 300));
}

async function main(): Promise<void> {
  const queries = [
    'digital minimalism ebook gumroad',
    'site:amazon.com kindle digital minimalism',
  ];
  for (const q of queries) {
    await testBing(q);
    await testGooglethisRaw(q);
  }
}

main().catch(console.error);
