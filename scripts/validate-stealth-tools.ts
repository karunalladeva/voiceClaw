import dotenv from 'dotenv';
import { configManager } from '../src/config/index';
import { webSearchTool, webFetchTool } from '../src/tools/search';

dotenv.config();

async function main(): Promise<void> {
  await configManager.initialize();

  console.log('=== web_search ===\n');
  const queries = [
    'site:github.com voice assistant open source',
    'digital minimalism ebook gumroad',
  ];
  for (const query of queries) {
    console.log(`--- ${query} ---`);
    const result = await webSearchTool.execute({ query });
    console.log(String(result).slice(0, 600));
    console.log(`\nlength: ${String(result).length}\n`);
  }

  console.log('=== web_fetch (Impit + Readability) ===\n');
  const fetchOut = await webFetchTool.execute({
    url: 'https://github.com/topics/voice-assistant',
    part: 0,
  });
  console.log(String(fetchOut).slice(0, 800));
  console.log(`\nlength: ${String(fetchOut).length}\n`);
}

main().catch(console.error);
