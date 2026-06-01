import * as https from 'https';

function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }, timeout: 15000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseAmazonSearchHtml(html: string): Array<{ title: string; url: string }> {
  const results: Array<{ title: string; url: string }> = [];
  const patterns = [
    /<a[^>]*class="[^"]*a-link-normal s-line-clamp[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi,
    /<span class="a-size-medium a-color-base a-text-normal">([^<]+)<\/span>/gi,
    /<h2[^>]*class="[^"]*a-size-mini[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && results.length < 5) {
      const title = (re === patterns[0] ? m[2] : m[1]).replace(/&amp;/g, '&').trim();
      const href = re === patterns[0] ? m[1] : '';
      if (title.length > 10 && !results.some((r) => r.title === title)) {
        const url = href.startsWith('http') ? href : href ? `https://www.amazon.com${href}` : 'https://www.amazon.com/s?k=';
        results.push({ title, url: url.split('?')[0].startsWith('http') ? url : `https://www.amazon.com${href}` });
      }
    }
    if (results.length >= 3) break;
  }
  return results;
}

async function main(): Promise<void> {
  const q = 'digital minimalism kindle';
  const html = await fetchHtml(`https://www.amazon.com/s?k=${encodeURIComponent(q)}`);
  console.log('htmlLen', html.length);
  const hits = parseAmazonSearchHtml(html);
  console.log('hits', hits.length);
  hits.forEach((h) => console.log('-', h.title.slice(0, 80), h.url.slice(0, 80)));
}

main().catch(console.error);
