import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export class BasicAgent {
  private llm: ChatOllama;

  constructor() {
    this.llm = new ChatOllama({
      model: 'llama3.1', // Ensure this model is available in your local Ollama
      temperature: 0.7,
      maxRetries: 1,
    });
  }

  /**
   * Process a user message through the basic LLM chain.
   * @param text The transcribed text from the user
   * @returns The text response from the LLM
   */
  async process(text: string): Promise<string> {
    try {
      console.log(`[Agent] Thinking about: "${text}"...`);
      
      const response = await this.llm.invoke([
        new SystemMessage(
          "You are a helpful, concise AI voice assistant. " +
          "Your responses will be spoken aloud by a Text-to-Speech engine, " +
          "so please keep them brief, natural, and avoid markdown or complex formatting."
        ),
        new HumanMessage(text),
      ]);

      const content = response.content.toString();
      console.log(`[Agent] Response: "${content}"`);
      return content;
      
    } catch (error: any) {
      console.error('[Agent] LLM Processing failed:', error);
      
      // Graceful Failure: Check if it's a connection issue to Ollama
      if (error.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) {
        return "I cannot connect to my brain. Please start Ollama.";
      }
      
      return "I'm sorry, I encountered an error while thinking.";
    }
  }
}