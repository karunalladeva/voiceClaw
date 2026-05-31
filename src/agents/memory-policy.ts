const EPHEMERAL_CHAT_ID_PREFIXES = ['pipeline-', 'channel-', 'pipe_'];

const EPHEMERAL_MEMORY_TAG_PREFIXES = [
  'system_setup',
  'workflow',
  'automation',
  'scheduled_task',
  'stock_tracking',
  'daily_report',
  'watchlist',
  'whatsapp_delivery',
];

const LIVE_VOLATILE_CONTENT_PATTERNS: RegExp[] = [
  /\b\d+\s*\/\s*\d+\b/,
  /\b(overs? left|runs? needed|current score|live score|match status)\b/i,
  /\b(ipl|cricket|qualifier|chase|innings)\b/i,
  /\b(price|trading at|market cap|52-week)\b.*\$\d/i,
  /\b(temperature|forecast|humidity)\b.*\d+/i,
];

const EPHEMERAL_CONTENT_PATTERNS: RegExp[] = [
  /^user has a daily workflow/i,
  /^automated daily/i,
  /^the system will/i,
  /^pipeline created/i,
  /^user intends to/i,
  /^user asked to/i,
  /^user wants to send/i,
  /^analysis for [A-Z]{1,5}/i,
  /^\*\*signal:\*\*/i,
  /^no response from agent/i,
  /^step \d+ \(/i,
  /^\[pipeline output\]/i,
  /^found \d+ related memories/i,
];

const TRANSIENT_INTENT_PATTERNS: RegExp[] = [
  /\bintends to\b/i,
  /\basked the agent\b/i,
  /\bvia the app\b/i,
  /\bevery day at \d/i,
  /\bwill monitor a watchlist\b/i,
];

const USER_FACT_PATTERNS: RegExp[] = [
  /\buser'?s (location|name|timezone|preferred|preference|schedule)\b/i,
  /\buser (is|lives|prefers|uses|speaks)\b/i,
  /\b(dubai|timezone|utc|morning|evening)\b/i,
];

export function isEphemeralChatId(chatId: string): boolean {
  const normalized = chatId.toLowerCase();
  return EPHEMERAL_CHAT_ID_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function hasEphemeralMemoryTags(tags: string[]): boolean {
  const normalized = tags.map((tag) => tag.toLowerCase());
  return normalized.some((tag) =>
    EPHEMERAL_MEMORY_TAG_PREFIXES.some((blocked) => tag.includes(blocked)),
  );
}

export function looksLikeLiveVolatileContent(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  return LIVE_VOLATILE_CONTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function looksLikeChatTranscript(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return true;
  if (looksLikeLiveVolatileContent(normalized)) return true;
  if (normalized.length > 280) return true;
  if (normalized.includes('\n- ') || normalized.includes('\n|')) return true;
  if ((normalized.match(/\*\*/g) || []).length >= 2) return true;
  return EPHEMERAL_CONTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isTransientIntentMemory(content: string): boolean {
  return TRANSIENT_INTENT_PATTERNS.some((pattern) => pattern.test(content));
}

export function isLikelyUserFact(content: string, tags: string[] = []): boolean {
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  if (normalizedTags.some((tag) => tag.includes('preference') || tag.includes('location'))) {
    return true;
  }
  return USER_FACT_PATTERNS.some((pattern) => pattern.test(content));
}

export function isValidLongTermMemory(content: string, tags: string[] = []): boolean {
  const normalized = content.trim();
  if (!normalized || normalized.length < 8 || normalized.length > 220) return false;
  if (hasEphemeralMemoryTags(tags)) {
    return isLikelyUserFact(normalized, tags);
  }
  if (looksLikeChatTranscript(normalized)) return false;
  if (isTransientIntentMemory(normalized) && !isLikelyUserFact(normalized, tags)) return false;
  if (/^(user is interested in|the user is interested in)/i.test(normalized) && normalized.length > 80) {
    return false;
  }
  return true;
}

export function shouldSkipAutoMemoryExtraction(
  chatId: string,
  userInput: string,
  agentResponse: string,
): boolean {
  if (isEphemeralChatId(chatId)) return true;
  const input = typeof userInput === 'string' ? userInput.trim() : '';
  const response = agentResponse.trim();
  if (looksLikeLiveVolatileContent(response)) return true;
  if (!input || input.length > 600) return true;
  if (input.includes('--- Context from previous step ---')) return true;
  if (input.startsWith('Use VoiceClaw Financial Analyst')) return true;
  if (response.length > 320) return true;
  if (looksLikeChatTranscript(response)) return true;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(input) && input.split(/\s+/).length <= 4) {
    return true;
  }
  return false;
}

export function filterMemoriesForContext<T extends { content: string; tags?: string[] }>(
  memories: T[],
): T[] {
  return memories.filter((memory) => {
    const tags = memory.tags || [];
    if (hasEphemeralMemoryTags(tags) && !isLikelyUserFact(memory.content, tags)) return false;
    if (looksLikeChatTranscript(memory.content)) return false;
    if (isTransientIntentMemory(memory.content)) return false;
    return true;
  });
}
