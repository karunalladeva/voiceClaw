/**
 * Run: npx ts-node tests/runtime/tao-loop.test.ts
 */
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from '../../src/llm/types';
import { defineTool } from '../../src/runtime/tools';
import { systemMessage, userMessage } from '../../src/runtime/messages';
import { runTaoLoop } from '../../src/runtime/tao-loop';

function createMockClient(responses: LlmCompleteResponse[]): LlmClient {
  let call = 0;
  return {
    modelId: 'mock',
    async complete(_req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
      const next = responses[call] ?? responses[responses.length - 1];
      call += 1;
      return next;
    },
  };
}

async function testFinalTextWithoutTools(): Promise<void> {
  const client = createMockClient([{ content: 'Hello from mock.' }]);
  const result = await runTaoLoop({
    client,
    tools: [],
    messages: [systemMessage('You are helpful.'), userMessage('Hi')],
    maxTurns: 3,
  });
  assert.equal(result.endedReason, 'final_text');
  assert.equal(result.finalText, 'Hello from mock.');
  assert.equal(result.messages.length, 3);
}

async function testToolRoundTrip(): Promise<void> {
  const echoTool = defineTool({
    name: 'echo',
    description: 'Echo input',
    schema: z.object({ text: z.string() }),
    execute: async ({ text }) => `echo:${text}`,
  });
  const client = createMockClient([
    {
      content: '',
      toolCalls: [{ id: 'tc1', name: 'echo', args: { text: 'ping' } }],
    },
    { content: 'Done: echo:ping' },
  ]);
  const result = await runTaoLoop({
    client,
    tools: [echoTool],
    messages: [userMessage('run echo')],
    maxTurns: 5,
  });
  assert.equal(result.endedReason, 'final_text');
  assert.equal(result.finalText, 'Done: echo:ping');
  const toolMsgs = result.messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 1);
  assert.match(String(toolMsgs[0].content), /echo:ping/);
}

async function run(): Promise<void> {
  await testFinalTextWithoutTools();
  await testToolRoundTrip();
  console.log('tao-loop: all tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
