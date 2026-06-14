import type { Express } from 'express';
import { ReactAgent } from '../agents/react-agent';
import { classifyMicroRoute, clearMicroRouteCache } from '../agents/micro-router';
import { buildRoutableCatalog, collectCatalogLanes } from '../agents/micro-router-catalog';

export function setupMicroRouterAdminRoutes(app: Express, agent: ReactAgent): void {
  app.get('/admin/api/micro-router/catalog', (_req, res) => {
    const ctx = agent.getMicroRouterContext();
    const catalog = buildRoutableCatalog(ctx.skills, ctx.tools);
    const lanes = collectCatalogLanes(catalog);
    const laneCounts: Record<string, number> = {};
    for (const entry of catalog) {
      for (const lane of entry.laneHints) {
        laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
      }
    }
    res.json({
      skillCount: ctx.skills.length,
      toolCount: ctx.tools.length,
      entryCount: catalog.length,
      lanes,
      laneCounts,
      entries: catalog.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        lanes: entry.laneHints,
        description: entry.description.slice(0, 120),
      })),
    });
  });

  app.post('/admin/api/micro-router/classify', async (req, res) => {
    const query = String(req.body?.query ?? '').trim();
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    try {
      const result = await classifyMicroRoute(query, agent.getMicroRouterContext());
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/admin/api/micro-router/clear-cache', (_req, res) => {
    clearMicroRouteCache();
    res.json({ success: true });
  });
}
