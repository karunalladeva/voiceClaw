import { Router, Express, Request, Response } from 'express';
import { searxngHealthCheck } from '../tools/searxng-client';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const status = await searxngHealthCheck();
    res.json(status);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post('/probe', async (_req: Request, res: Response) => {
  try {
    const status = await searxngHealthCheck();
    res.json(status);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export function setupSearxngRoutes(app: Express): void {
  app.use('/searxng', router);
}
