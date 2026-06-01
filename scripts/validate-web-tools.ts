/**
 * Validates web_search and web_fetch against marketplace URLs from ebook-validation runs.
 * Usage: npx ts-node scripts/validate-web-tools.ts
 */
import { webSearchTool, webFetchTool } from '../src/tools/search';

const SEARCH_QUERIES = [
  'site:amazon.com kindle digital minimalism bestseller BSR',
  'site:gumroad.com digital minimalism reviews',
  'digital minimalism ebook gumroad',
];

const FETCH_URLS = [
  'https://www.amazon.com/s?k=digital+minimalism',
  'https://www.amazon.com/Brad-Shahans-Digital-Minimalism/dp/160690534X',
  'https://www.gumroad.com/search?q=digital+minimalism&s=relevance&page=1',
  'https://www.gumroad.com/s/digital-minimalism-reviews',
];

async function main(): Promise<void> {
  console.log('=== web_search validation ===\n');
  for (const query of SEARCH_QUERIES) {
    console.log(`\n--- Query: ${query} ---`);
    const result = await webSearchTool.invoke({ query });
    const preview = String(result).slice(0, 500);
    console.log(preview);
    console.log(`\n[summary] output length: ${String(result).length}`);
  }

  console.log('\n\n=== web_fetch validation ===\n');
  for (const url of FETCH_URLS) {
    console.log(`\n--- URL: ${url} ---`);
    const result = await webFetchTool.invoke({ url, offset: 0 });
    const preview = String(result).slice(0, 400);
    console.log(preview);
    const match = String(result).match(/length: (\d+)\/(\d+)/);
    console.log(
      `\n[summary] slice/total: ${match ? `${match[1]}/${match[2]}` : 'n/a'}, output len: ${String(result).length}`,
    );
  }

  console.log('\n\nDone. Check debug-ce907e.log for structured hypothesis logs.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
