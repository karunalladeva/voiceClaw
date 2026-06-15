import { BaseMessage, ToolMessage } from '@langchain/core/messages';
import { trimMessages } from '@langchain/core/messages';
import { configManager } from '../../config/index';

export async function trimMessagesForModel(
  messages: BaseMessage[],
  maxTokens = 8000,
): Promise<BaseMessage[]> {
  const trimmer = trimMessages({
    maxTokens,
    strategy: 'last',
    includeSystem: true,
    startOn: 'human',
    tokenCounter: (msgs) =>
      msgs.reduce((sum, m) => sum + (m.content?.toString?.().length ?? 0) / 4, 0),
  });
  return trimmer.invoke(messages.filter((msg): msg is BaseMessage => msg != null));
}

export function isPreModelTrimEnabled(): boolean {
  return configManager.getConfig().agent?.context?.governor?.enabled === true;
}

export function countToolMessages(messages: BaseMessage[]): ToolMessage[] {
  return messages.filter((m): m is ToolMessage => m instanceof ToolMessage);
}
