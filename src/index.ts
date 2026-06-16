import dotenv from 'dotenv';
import { startServer } from './api/server';
import { sessionRuntime } from './platform/session/session-runtime';
import { configManager } from './config/index';
import { probeSearxngAvailability, invalidateSearxngProbeCache } from './tools/searxng-client';
import { resetImpitClient } from './tools/web-page-fetch';
import { ensureWorkspaceDirs } from './utils/workspace-dirs';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function bootstrap() {
  console.log('=============================================');
  console.log('🤖 Starting Local Talking LLM Gateway...');
  console.log('=============================================');
  
  await configManager.initialize();
  await ensureWorkspaceDirs();
  await sessionRuntime.initialize();

  configManager.on('configChanged', () => {
    invalidateSearxngProbeCache();
    resetImpitClient();
    void probeSearxngAvailability(true);
  });

  await probeSearxngAvailability(true);

  // Start the server
  await startServer(PORT);
}

bootstrap().catch(err => {
  console.error('[Gateway] Failed to start server:', err);
  process.exit(1);
});