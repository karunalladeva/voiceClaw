import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { chromium } from 'playwright';

export const webSearchTool = tool(
  async ({ query }) => {
    let browser;
    try {
      console.log(`[Tool: Web Search] Searching via Browser for: "${query}"`);
      
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      
      // Use Yahoo search as it is more reliable for scraping than DuckDuckGo HTML which blocks headless browsers
      await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`);
      
      // Wait a moment for results to load
      await page.waitForTimeout(2000);
      
      // Extract top results
      const results = await page.$$eval('.algo', (elements) => {
        return elements.slice(0, 3).map(el => {
          const titleEl = el.querySelector('a, h3');
          const snippetEl = el.querySelector('.compTitle + div, .compText, p');
          const urlEl = el.querySelector('a');
          
          return {
            title: titleEl ? titleEl.textContent?.trim() : '',
            snippet: snippetEl ? snippetEl.textContent?.trim() : '',
            url: urlEl ? urlEl.getAttribute('href')?.trim() : ''
          };
        }).filter(r => r.title && r.snippet); // Filter out empty results
      });
      
      await browser.close();
      
      if (!results || results.length === 0) {
        return "No results found on the internet for this query.";
      }
      
      const formattedResults = results.map(r => {
        return `Title: ${r.title}\nDescription: ${r.snippet}\nURL: ${r.url}`;
      }).join('\n\n');
      
      return formattedResults;
    } catch (e: any) {
      if (browser) await browser.close();
      console.error('[Tool: Web Search] Search failed:', e);
      return `Failed to search the internet: ${e.message}`;
    }
  },
  {
    name: "web_search",
    description: "Search the internet for up-to-date information, facts, or news if you do not know the answer. Returns titles, descriptions, and URLs of search results.",
    schema: z.object({
      query: z.string().describe("The search query to look up on the internet.")
    })
  }
);
