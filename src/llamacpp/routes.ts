import { Router, Express, Request, Response } from 'express';
import { llamacppService } from '../services/llamacpp-service';
import { modelRouter } from '../models/model-router';

const router = Router();

router.get('/health', async (req: Request, res: Response) => {
  try {
    const baseUrl = typeof req.query.baseUrl === 'string' ? req.query.baseUrl : undefined;
    const status = await llamacppService.healthCheck(baseUrl);
    res.json(status);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Health check failed' });
  }
});

router.get('/models', async (req: Request, res: Response) => {
  try {
    const baseUrl = typeof req.query.baseUrl === 'string' ? req.query.baseUrl : undefined;
    const models = await llamacppService.listModels(baseUrl);
    res.json({ models });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list models' });
  }
});

router.post('/load', async (req: Request, res: Response) => {
  try {
    const body = req.body as { model?: string; baseUrl?: string };
    if (!body.model?.trim()) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    const ok = await llamacppService.loadModel(body.model.trim(), body.baseUrl);
    if (!ok) {
      res.status(502).json({ error: `Failed to load model "${body.model}"` });
      return;
    }
    res.json({ success: true, model: body.model.trim() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Load failed' });
  }
});

router.post('/unload', async (req: Request, res: Response) => {
  try {
    const body = req.body as { model?: string; baseUrl?: string };
    if (!body.model?.trim()) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    await llamacppService.unloadModel(body.model.trim(), body.baseUrl);
    res.json({ success: true, model: body.model.trim() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unload failed' });
  }
});

router.post('/warm', async (req: Request, res: Response) => {
  try {
    const body = req.body as { model?: string; baseUrl?: string };
    if (!body.model?.trim()) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    await llamacppService.warmModel(body.model.trim(), body.baseUrl);
    res.json({ success: true, model: body.model.trim() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Warm failed' });
  }
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      model?: string;
      id?: string;
      name?: string;
      setMaster?: boolean;
      baseUrl?: string;
    };
    if (!body.model?.trim()) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    const saved = await llamacppService.registerModel({
      modelName: body.model.trim(),
      id: body.id,
      name: body.name,
      setMaster: body.setMaster,
      baseUrl: body.baseUrl,
    });
    modelRouter.invalidate(saved.id);
    res.json({ success: true, model: saved });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Register failed' });
  }
});

router.post('/use-master', async (req: Request, res: Response) => {
  try {
    const body = req.body as { model?: string; baseUrl?: string };
    if (!body.model?.trim()) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    const saved = await llamacppService.useAsMaster(body.model.trim(), body.baseUrl);
    modelRouter.invalidate();
    res.json({ success: true, model: saved });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to set master' });
  }
});

router.post('/server/start', async (_req: Request, res: Response) => {
  try {
    const result = await llamacppService.startServer();
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start server' });
  }
});

router.post('/server/stop', async (_req: Request, res: Response) => {
  try {
    await llamacppService.stopServer();
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to stop server' });
  }
});

export function setupLlamaCppRoutes(app: Express): void {
  app.use('/llamacpp', router);
}
