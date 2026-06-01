import * as https from 'https';
import * as fs from 'fs';

const query = process.argv[2] ?? 'digital minimalism ebook';
const q = encodeURIComponent(query);

const req = https.get(`https://html.duckduckgo.com/html/?q=${q}`, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
  },
  timeout: 15000,
}, (res) => {
  console.log('status', res.statusCode);
  console.log('location', res.headers.location ?? 'none');
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => {
    const html = Buffer.concat(chunks).toString('utf-8');
    console.log('htmlLen', html.length);
    console.log('hasResult__a', /result__a/.test(html));
    console.log('hasResultLink', /result-link/.test(html));
    console.log('hasResultsLinks', /results_links/.test(html));
    const blockRe =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const m = blockRe.exec(html);
    console.log('firstMatch', m ? m[1].slice(0, 80) : 'none');
    const classHits = [...html.matchAll(/class="([^"]{3,40})"/g)]
      .slice(0, 20)
      .map((x) => x[1]);
    console.log('sampleClasses', classHits.join(' | '));
    console.log('bodyPreview', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400));
    fs.appendFileSync(
      'debug-ce907e.log',
      JSON.stringify({
        sessionId: 'ce907e',
        hypothesisId: 'H1',
        location: 'inspect-ddg.ts',
        message: 'ddg inspect',
        data: {
          query,
          status: res.statusCode,
          htmlLen: html.length,
          hasResult__a: /result__a/.test(html),
          hasResultLink: /result-link/.test(html),
        },
        timestamp: Date.now(),
      }) + '\n',
    );
  });
});
req.on('error', (e) => console.error('err', e.message));
req.on('timeout', () => {
  console.error('timeout');
  req.destroy();
});
