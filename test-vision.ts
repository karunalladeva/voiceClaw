import { windowsReadScreenTool } from './src/tools/windows';
import { modelRegistry } from './src/models/model-registry';

async function main() {
  await modelRegistry.initialize();
  console.log('Testing windowsReadScreenTool...');
  const result = await windowsReadScreenTool.invoke({ query: 'What do you see?' });
  console.log('RESULT:', result);
}

main().catch(console.error);
