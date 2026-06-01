import { webSearchTool, webFetchTool } from '../src/tools/search';

async function main(): Promise<void> {
  console.log('=== stealth web_search ===\n');
  const queries = [
    'site:amazon.com kindle digital minimalism bestseller',
    'digital minimalism ebook gumroad',
  ];
  for (const query of queries) {
    console.log(`--- ${query} ---`);
    const result = await webSearchTool.invoke({ query });
    console.log(String(result).slice(0, 600));
    console.log(`\nlength: ${String(result).length}\n`);
  }

  console.log('=== stealth web_fetch (blocked URL) ===\n');
  const blocked = await webFetchTool.invoke({
    url: 'https://www.amazon.com/Brad-Shahans-Digital-Minimalism/dp/160690534X',
    offset: 0,
  });
  console.log(String(blocked).slice(0, 300));
}

main().catch(console.error);
