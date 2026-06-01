/* eslint-disable @typescript-eslint/no-require-imports */
const google = require('googlethis');

async function main(): Promise<void> {
  const queries = [
    'site:amazon.com kindle digital minimalism bestseller',
    'site:gumroad.com digital minimalism reviews',
    'digital minimalism ebook gumroad',
  ];
  for (const query of queries) {
    console.log('\n---', query, '---');
    try {
      const results = await google.search(query, { page: 0, safe: false });
      const hits = (results.results || []).slice(0, 3);
      console.log('hitCount', hits.length);
      for (const h of hits) {
        console.log(' title:', h.title?.slice(0, 80));
        console.log(' url:', h.url?.slice(0, 100));
        console.log(' desc:', h.description?.slice(0, 100));
      }
    } catch (e: unknown) {
      console.error('err', e instanceof Error ? e.message : e);
    }
  }
}

main();
