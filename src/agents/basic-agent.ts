import { modelRouter } from '../models/model-router';
import { systemMessage, userMessage } from '../runtime/messages';

export class BasicAgent {
  /**
   * Process a user message through the basic LLM chain.
   * @param text The transcribed text from the user
   * @returns The text response from the LLM
   */
  async process(text: string): Promise<string> {
    try {
      console.log(`[Agent] Thinking about: "${text}"...`);
      const llm = await modelRouter.getMasterModel();
      const response = await llm.complete({
        messages: [
          systemMessage(
            'You are a helpful, concise AI voice assistant. ' +
              'Your responses will be spoken aloud by a Text-to-Speech engine, ' +
              'so please keep them brief, natural, and avoid markdown or complex formatting.',
          ),
          userMessage(text),
        ],
        label: 'basic-agent',
      });
      const content = response.content;
      console.log(`[Agent] Response: "${content}"`);
      return content;
    } catch (error: any) {
      console.error('[Agent] LLM Processing failed:', error);
      if (error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')) {
        return "I'm having trouble connecting to the language model. Please make sure Ollama is running.";
      }
      return 'Sorry, I encountered an error processing your request.';
    }
  }
}
