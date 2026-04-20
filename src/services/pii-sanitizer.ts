/**
 * PII Sanitizer — Regex-based Personal Identifiable Information redaction.
 *
 * Scans text for API keys, emails, phone numbers, IP addresses, file paths
 * containing usernames, and geographic addresses and replaces them with
 * [REDACTED_*] tags so training data never leaks secrets.
 */

interface SanitizeResult {
  cleaned: string;
  redactions: number;
}

interface PatternEntry {
  pattern: RegExp;
  replacement: string;
}

const PII_PATTERNS: PatternEntry[] = [
  // ── API Keys & Tokens ────────────────────────────────────────────────────
  { pattern: /sk-proj-[A-Za-z0-9_\-]{20,}/g,       replacement: '[REDACTED_OPENAI_KEY]' },
  { pattern: /sk-[A-Za-z0-9]{32,}/g,                 replacement: '[REDACTED_API_KEY]' },
  { pattern: /ghp_[A-Za-z0-9]{36,}/g,                replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /gho_[A-Za-z0-9]{36,}/g,                replacement: '[REDACTED_GITHUB_OAUTH]' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g,        replacement: '[REDACTED_GITHUB_PAT]' },
  { pattern: /AIza[A-Za-z0-9_\-]{30,}/g,             replacement: '[REDACTED_GOOGLE_KEY]' },
  { pattern: /ya29\.[A-Za-z0-9_\-]{50,}/g,           replacement: '[REDACTED_GOOGLE_OAUTH]' },
  { pattern: /xoxb-[A-Za-z0-9\-]{20,}/g,             replacement: '[REDACTED_SLACK_TOKEN]' },
  { pattern: /xoxp-[A-Za-z0-9\-]{20,}/g,             replacement: '[REDACTED_SLACK_TOKEN]' },
  { pattern: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g,      replacement: 'Bearer [REDACTED_BEARER]' },
  { pattern: /AKIA[A-Z0-9]{16}/g,                    replacement: '[REDACTED_AWS_KEY]' },
  { pattern: /mongodb(\+srv)?:\/\/[^\s"']+/g,        replacement: '[REDACTED_MONGO_URI]' },
  { pattern: /redis:\/\/[^\s"']+/g,                  replacement: '[REDACTED_REDIS_URI]' },

  // ── Email Addresses ──────────────────────────────────────────────────────
  { pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },

  // ── Phone Numbers (international formats) ────────────────────────────────
  { pattern: /(\+?\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g, replacement: '[REDACTED_PHONE]' },

  // ── IP Addresses ─────────────────────────────────────────────────────────
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[REDACTED_IP]' },

  // ── Windows file paths with usernames ────────────────────────────────────
  { pattern: /[A-Z]:\\Users\\[^\\"\s]+/g,           replacement: '[REDACTED_USER_PATH]' },
  { pattern: /\/home\/[^\/"\s]+/g,                   replacement: '[REDACTED_USER_PATH]' },
  { pattern: /\/Users\/[^\/"\s]+/g,                  replacement: '[REDACTED_USER_PATH]' },

  // ── Geographic Addresses (common Dubai/UAE patterns + general) ───────────
  { pattern: /\d+\s+(Dubai|Abu Dhabi|Sharjah|Ajman|Fujairah)[^,\n"]{0,80}/gi, replacement: '[REDACTED_ADDRESS]' },
  { pattern: /P\.?O\.?\s*Box\s*\d+/gi,               replacement: '[REDACTED_PO_BOX]' },
];

/**
 * Sanitize text by replacing all PII matches with redaction tags.
 */
export function sanitize(text: string): SanitizeResult {
  let cleaned = text;
  let redactions = 0;

  for (const { pattern, replacement } of PII_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    const matches = cleaned.match(pattern);
    if (matches) {
      redactions += matches.length;
      cleaned = cleaned.replace(pattern, replacement);
    }
  }

  return { cleaned, redactions };
}

/**
 * Quick check — does this text contain any detectable PII?
 */
export function containsPII(text: string): boolean {
  for (const { pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
