import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ModelConfig } from './types';

/**
 * Factory that creates a LangChain BaseChatModel from any ModelConfig.
 * Provider packages are imported dynamically so the server starts even if
 * optional packages are not installed.
 */
export async function createProvider(config: ModelConfig): Promise<BaseChatModel> {
  const { provider, model, baseUrl, auth } = config;

  switch (provider) {
    // ── Local / self-hosted ───────────────────────────────────────────────────

    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama');
      return new ChatOllama({
        model,
        baseUrl: baseUrl || 'http://localhost:11434',
        keepAlive: -1,
        ...(auth?.customHeaders ? { headers: auth.customHeaders } : {}),
      }) as unknown as BaseChatModel;
    }

    case 'lmstudio': {
      // LM Studio exposes an OpenAI-compatible REST API
      const { ChatOpenAI } = await import('@langchain/openai');
      console.log('LM Studio config:', { model, baseUrl, auth });
      return new ChatOpenAI({
        modelName: model,
        apiKey: auth?.apiKey || 'lm-studio',
        configuration: {
          baseURL: baseUrl || 'http://localhost:1234/v1',
          defaultHeaders: auth?.customHeaders,
        },
      }) as unknown as BaseChatModel;
    }

    case 'llamacpp': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const { getLlamacppOpenAiUrl } = await import('./llamacpp-client');
      const openAiUrl = getLlamacppOpenAiUrl(config);
      return new ChatOpenAI({
        modelName: model,
        apiKey: auth?.apiKey || auth?.bearer || 'llamacpp',
        configuration: {
          baseURL: openAiUrl,
          defaultHeaders: auth?.customHeaders,
        },
      }) as unknown as BaseChatModel;
    }

    // ── Cloud providers ──────────────────────────────────────────────────────

    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        modelName: model,
        apiKey: auth?.apiKey,
        configuration: {
          ...(baseUrl ? { baseURL: baseUrl } : {}),
          defaultHeaders: buildAuthHeaders(auth),
        },
      }) as unknown as BaseChatModel;
    }

    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      return new ChatAnthropic({
        modelName: model,
        anthropicApiKey: auth?.apiKey,
        ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}),
      }) as unknown as BaseChatModel;
    }

    case 'google': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      return new ChatGoogleGenerativeAI({
        model,
        apiKey: auth?.apiKey,
      }) as unknown as BaseChatModel;
    }

    case 'mistral': {
      const { ChatMistralAI } = await import('@langchain/mistralai');
      return new ChatMistralAI({
        modelName: model,
        apiKey: auth?.apiKey,
        ...(baseUrl ? { endpoint: baseUrl } : {}),
      }) as unknown as BaseChatModel;
    }

    case 'deepseek': {
      // DeepSeek is OpenAI-compatible
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        modelName: model,
        apiKey: auth?.apiKey,
        configuration: {
          baseURL: baseUrl || 'https://api.deepseek.com/v1',
          defaultHeaders: auth?.customHeaders,
        },
      }) as unknown as BaseChatModel;
    }

    case 'custom': {
      // Any OpenAI-compatible endpoint (e.g. Together AI, Groq, local vLLM, etc.)
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        modelName: model,
        apiKey: auth?.apiKey || auth?.bearer || 'custom',
        configuration: {
          ...(baseUrl ? { baseURL: baseUrl } : {}),
          defaultHeaders: buildAuthHeaders(auth),
        },
      }) as unknown as BaseChatModel;
    }

    default:
      throw new Error(`[ProviderFactory] Unsupported provider: "${provider}"`);
  }
}

function buildAuthHeaders(auth?: ModelConfig['auth']): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (auth?.bearer) headers['Authorization'] = `Bearer ${auth.bearer}`;
  if (auth?.customHeaders) Object.assign(headers, auth.customHeaders);
  return Object.keys(headers).length ? headers : undefined;
}
