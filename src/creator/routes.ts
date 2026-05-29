import { Router } from 'express';
import {
  checkCreatorConflicts,
  deleteCreatorItem,
  generateCreatorItems,
  getCreatorItem,
  getPurposePresets,
  listCreatorItems,
  regenerateCreatorItem,
  setCreatorItemStatus,
  type CreatorItemType,
  updateCreatorItem,
} from './workspace-creator';
import { CreatorPolicyError, CreatorValidationError } from './creator-llm';
import { notifyOrchestrationUpdate } from '../admin/admin-server';

const router = Router();

router.use((req, res, next) => {
  res.on('finish', () => {
    if (req.method === 'GET') return;
    if (res.statusCode >= 400) return;
    notifyOrchestrationUpdate('creator');
  });
  next();
});

function sendCreatorError(res: any, error: any): void {
  if (error instanceof CreatorPolicyError) {
    res.status(422).json({
      error: error.message,
      code: error.code,
      details: error.details,
      remediation: 'Adjust your prompt to avoid destructive, credential, or auto-exec behaviors, then regenerate.',
    });
    return;
  }
  if (error instanceof CreatorValidationError) {
    res.status(422).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  res.status(400).json({
    error: error?.message || 'unknown creator error',
    code: 'creator_request_failed',
  });
}

function parseType(raw: string): CreatorItemType {
  if (raw === 'skill' || raw === 'mcp' || raw === 'template') return raw;
  throw new Error('invalid type');
}

router.get('/purposes', async (_req, res) => {
  res.json({ purposes: getPurposePresets() });
});

router.get('/items', async (req, res) => {
  try {
    const type = req.query.type ? parseType(String(req.query.type)) : undefined;
    const purpose = req.query.purpose ? String(req.query.purpose) : undefined;
    const status = req.query.status ? String(req.query.status) as 'draft' | 'approved' | 'disabled' : undefined;
    const items = await listCreatorItems(type, purpose, status);
    res.json({ items });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/check-conflict', async (req, res) => {
  try {
    const type = parseType(String(req.body?.type || ''));
    const name = String(req.body?.name || '');
    const purpose = String(req.body?.purpose || '');
    const result = await checkCreatorConflicts(type, name, purpose);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const created = await generateCreatorItems(req.body || {});
    const items = await Promise.all(created.map((entry) => getCreatorItem(entry.type, entry.slug)));
    res.json({ success: true, created, items: items.filter(Boolean) });
  } catch (e: any) {
    sendCreatorError(res, e);
  }
});

router.get('/items/:type/:name', async (req, res) => {
  try {
    const type = parseType(req.params.type);
    const item = await getCreatorItem(type, req.params.name);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/items/:type/:name', async (req, res) => {
  try {
    const type = parseType(req.params.type);
    const updated = await updateCreatorItem(type, req.params.name, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true, item: updated });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/items/:type/:name/regenerate', async (req, res) => {
  try {
    const type = parseType(req.params.type);
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const updated = await regenerateCreatorItem(type, req.params.name, prompt);
    if (!updated) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true, item: updated });
  } catch (e: any) {
    sendCreatorError(res, e);
  }
});

router.post('/items/:type/:name/status', async (req, res) => {
  try {
    const type = parseType(req.params.type);
    const status = String(req.body?.status || '') as 'draft' | 'approved' | 'disabled';
    if (!['draft', 'approved', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    const updated = await setCreatorItemStatus(type, req.params.name, status);
    if (!updated) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true, item: updated });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/items/:type/:name', async (req, res) => {
  try {
    const type = parseType(req.params.type);
    const ok = await deleteCreatorItem(type, req.params.name);
    if (!ok) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export function setupCreatorRoutes(app: any): void {
  app.use('/creator', router);
  console.log('[Creator] API routes registered at /creator/*');
}
