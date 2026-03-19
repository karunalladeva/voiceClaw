import dotenv from 'dotenv';
import { startServer } from './api/server';
import { configManager } from './config/index';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function bootstrap() {
  console.log('=============================================');
  console.log('🤖 Starting Local Talking LLM Gateway...');
  console.log('=============================================');
  
  // Initialize the config manager (loads file, sets up watcher)
  await configManager.initialize();

  // Start the server
  await startServer(PORT);
}

bootstrap().catch(err => {
  console.error('[Gateway] Failed to start server:', err);
  process.exit(1);
});