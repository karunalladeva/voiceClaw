import { Router, Express, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs/promises';
import { comfyUIService, GenerateRequest } from '../services/comfyui-service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const status = await comfyUIService.healthCheck();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workflows', (_req: Request, res: Response) => {
  try {
    res.json({ workflows: comfyUIService.listWorkflows() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workflows/reload', async (_req: Request, res: Response) => {
  try {
    const count = await comfyUIService.reloadWorkflows();
    res.json({ success: true, count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workflows/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ error: 'No file uploaded. Use multipart field "file".' });
      return;
    }
    const workflow = await comfyUIService.uploadWorkflow(req.file.buffer, req.file.originalname);
    res.json({ success: true, workflow });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/workflows/import', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      filename?: string;
      id?: string;
      name?: string;
      type?: 'image' | 'video';
      description?: string;
      injections?: Record<string, { nodeId: string; field: string }>;
    };
    if (!body.filename) {
      res.status(400).json({ error: 'filename is required' });
      return;
    }
    const workflow = await comfyUIService.importComfyUIUserWorkflow({
      filename: body.filename,
      id: body.id,
      name: body.name,
      type: body.type,
      description: body.description,
      injections: body.injections,
    });
    res.json({ success: true, workflow });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/workflows/suggest-injections', (req: Request, res: Response) => {
  try {
    const workflow = req.body?.workflow as Record<string, unknown> | undefined;
    if (!workflow) {
      res.status(400).json({ error: 'workflow graph is required' });
      return;
    }
    res.json({
      injections: comfyUIService.suggestInjectionsForGraph(workflow),
      type: comfyUIService.detectWorkflowTypeForGraph(workflow),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/workflows/:id', (req: Request, res: Response) => {
  try {
    const workflow = comfyUIService.getWorkflow(String(req.params.id));
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json({ workflow });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/workflows/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const workflow = await comfyUIService.updateWorkflow(id, req.body ?? {});
    res.json({ success: true, workflow });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/workflows/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await comfyUIService.deleteWorkflow(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/userdata/workflows', async (_req: Request, res: Response) => {
  try {
    const files = await comfyUIService.listComfyUIUserWorkflows();
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/userdata/workflows/:filename', async (req: Request, res: Response) => {
  try {
    const filename = String(req.params.filename);
    const preview = await comfyUIService.previewComfyUIUserWorkflow(filename);
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const body = req.body as GenerateRequest;
    if (!body.workflowId || !body.prompt) {
      res.status(400).json({ error: 'workflowId and prompt are required' });
      return;
    }
    const asyncMode = req.query.async === 'true';
    const result = await comfyUIService.generate({
      ...body,
      waitForCompletion: asyncMode ? false : body.waitForCompletion !== false,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:promptId', (req: Request, res: Response) => {
  const promptId = String(req.params.promptId);
  const job = comfyUIService.getJob(promptId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

router.get('/outputs/:promptId/:filename', async (req: Request, res: Response) => {
  try {
    const promptId = String(req.params.promptId);
    const filename = String(req.params.filename);
    const filePath = comfyUIService.resolveOutputFilePath(promptId, filename);
    if (!filePath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export function setupComfyUIRoutes(app: Express): void {
  app.use('/comfyui', router);
}
