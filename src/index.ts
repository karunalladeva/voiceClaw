import dotenv from 'dotenv';
import { startServer } from './api/server';
import { configManager } from './config/index';
import { probeSearxngAvailability, invalidateSearxngProbeCache } from './tools/searxng-client';
import { resetImpitClient } from './tools/web-page-fetch';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function bootstrap() {
  console.log('=============================================');
  console.log('🤖 Starting Local Talking LLM Gateway...');
  console.log('=============================================');
  
  if (process.env.LANGCHAIN_TRACING_V2 === 'true') {
    const endpoint = process.env.LANGCHAIN_ENDPOINT || 'https://api.smith.langchain.com';
    console.log(`\n🔍 LangSmith Observability is ENABLED!`);
    console.log(`   Monitoring all agent steps, models, and tokens -> ${endpoint}\n`);
  } else {
    console.log(`\nℹ️  Notice: LangSmith tracing is currently disabled.`);
    console.log(`   To monitor agent activity and tokens locally, set LANGCHAIN_TRACING_V2=true and LANGCHAIN_ENDPOINT=http://localhost:1984 in \`.env\`\n`);
  }

  // Initialize the config manager (loads file, sets up watcher)
  await configManager.initialize();

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