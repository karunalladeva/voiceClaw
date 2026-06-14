/**
 * Smoke-test gateway micro-router (dynamic lanes from full catalog, no LLM).
 * Run: npx tsx scripts/validate-micro-router.ts
 */
import { classifyMicroRoute, clearMicroRouteCache } from '../src/agents/micro-router';
import { configManager } from '../src/config/index';
import { loadNativeTools } from '../src/loaders/tool-loader';
import { SkillRegistry } from '../src/skills/registry';

const CASES: Array<{ query: string; expect: string }> = [
  { query: 'Draw a sunset over the mountains', expect: 'comfyui' },
  { query: 'Generate an image of a cat wearing a hat', expect: 'comfyui' },
  { query: 'Optimize my Etsy listing tags for a printable planner', expect: 'digital-products' },
  { query: 'Write Gumroad cover copy for my PDF guide', expect: 'digital-products' },
  { query: 'What is the weather in London today?', expect: 'general' },
  { query: 'What is the RSI for AAPL?', expect: 'trading' },
  { query: 'Search the web for latest AI news', expect: 'research' },
  { query: 'hi', expect: 'general' },
];

async function main(): Promise<void> {
  await configManager.initialize();
  const agentCfg = configManager.getConfig().agent;
  if (agentCfg?.microRouter) {
    agentCfg.microRouter.useLlmFallback = false;
  }

  const registry = new SkillRegistry();
  await registry.discover();
  const skills = registry.getEnabledSkills();
  const tools = await loadNativeTools(configManager.getConfig().agent?.enableInternet ?? true);

  console.log(`[validate] Catalog: ${skills.length} skills, ${tools.length} native tools`);

  clearMicroRouteCache();
  let failed = 0;

  const ctx = { skills, tools };

  for (const { query, expect } of CASES) {
    const result = await classifyMicroRoute(query, ctx);
    const ok = result.category === expect;
    const mark = ok ? 'OK' : 'FAIL';
    const top = result.matches
      .slice(0, 2)
      .map((m) => `${m.kind}:${m.id}`)
      .join(', ');
    console.log(
      `${mark}  "${query}" → ${result.category} (${result.method})` +
        (top ? ` [${top}]` : '') +
        ` expected ${expect}`,
    );
    if (!ok) failed += 1;
  }

  if (failed > 0) {
    console.error(`\n${failed} case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${CASES.length} micro-router cases passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
