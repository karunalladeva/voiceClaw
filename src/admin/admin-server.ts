import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import * as path from 'path';
import * as os from 'os';
import { agentEvents, AgentEvent } from './agent-events';
import { modelRegistry } from '../models/model-registry';
import { configManager } from '../config/index';

interface AdminClient {
  ws: WebSocket;
  subscribedTo: Set<string>;
  connectedAt: number;
}

const clients: Map<string, AdminClient> = new Map();

export function broadcastAdminMessage(payload: Record<string, unknown>): void {
  const message = JSON.stringify(payload);
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

export function notifyOrchestrationUpdate(topic: string): void {
  broadcastAdminMessage({
    type: 'orchestration:update',
    topic,
    timestamp: Date.now(),
  });
}

export function setupAdminWebSocket(server: any): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/admin/ws' });

  wss.on('connection', (ws, req) => {
    const clientId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const client: AdminClient = {
      ws,
      subscribedTo: new Set(['all']),
      connectedAt: Date.now(),
    };
    clients.set(clientId, client);

    agentEvents.log('info', `Admin client connected: ${clientId}`);

    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      serverTime: Date.now(),
    }));

    ws.send(JSON.stringify({
      type: 'snapshot',
      stats: agentEvents.getStats(),
      activeAgents: agentEvents.getActiveAgents(),
      recentEvents: agentEvents.getRecentEvents(50),
    }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleClientMessage(clientId, client, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      agentEvents.log('info', `Admin client disconnected: ${clientId}`);
    });

    ws.on('error', (err) => {
      agentEvents.log('error', `WebSocket error for ${clientId}:`, { error: err.message });
      clients.delete(clientId);
    });
  });

  agentEvents.on('event', (event: AgentEvent) => {
    const message = JSON.stringify({ type: 'event', event });
    clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        if (client.subscribedTo.has('all') || client.subscribedTo.has(event.type)) {
          client.ws.send(message);
        }
      }
    });
  });

  setInterval(() => {
    const statsMsg = JSON.stringify({
      type: 'stats',
      stats: agentEvents.getStats(),
      activeAgents: agentEvents.getActiveAgents(),
    });
    clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(statsMsg);
      }
    });
  }, 1000);

  return wss;
}

function handleClientMessage(clientId: string, client: AdminClient, msg: any) {
  switch (msg.type) {
    case 'subscribe':
      if (Array.isArray(msg.events)) {
        client.subscribedTo = new Set(msg.events);
      }
      break;
    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
      break;
    case 'getHistory':
      client.ws.send(JSON.stringify({
        type: 'history',
        events: agentEvents.getRecentEvents(msg.limit || 100),
      }));
      break;
  }
}

export function setupAdminRoutes(app: express.Application) {
  const adminPublicDir = path.join(__dirname, 'public');
  const adminIndexHtml = path.join(adminPublicDir, 'index.html');

  app.use('/admin', express.static(adminPublicDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));

  // SPA routes (chat is a separate page, same bundle)
  app.get(['/admin/chat', '/chat'], (_req, res) => {
    res.sendFile(adminIndexHtml);
  });

  app.get('/admin/api/stats', (_req, res) => {
    res.json(agentEvents.getStats());
  });

  app.get('/admin/api/events', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json({ events: agentEvents.getRecentEvents(limit) });
  });

  app.get('/admin/api/agents', (_req, res) => {
    res.json({ agents: agentEvents.getActiveAgents() });
  });

  app.get('/admin/api/agents/tree', (_req, res) => {
    const tree = agentEvents.getAgentTree();
    res.json({
      main: tree.main,
      skills: Object.fromEntries(tree.skills),
    });
  });

  app.get('/admin/api/system', async (_req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    res.json({
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Unknown',
      totalMemoryGB: (totalMem / 1073741824).toFixed(2),
      freeMemoryGB: (freeMem / 1073741824).toFixed(2),
      memoryUsagePercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1),
      nodeVersion: process.version,
      pid: process.pid,
    });
  });

  app.get('/admin/api/models', (_req, res) => {
    const models = modelRegistry.getAll();
    const master = modelRegistry.getMaster();
    res.json({ models, masterId: master?.id });
  });

  app.get('/admin/api/config', (_req, res) => {
    res.json(configManager.getConfig());
  });

  app.post('/admin/api/config', async (req, res) => {
    try {
      await configManager.updateConfig(req.body);
      res.json({ success: true, config: configManager.getConfig() });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to update config', details: error.message });
    }
  });
}
