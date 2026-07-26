/**
 * Regex-based redaction for exports: secret-shaped tokens, emails, and home
 * paths are scrubbed before a session leaves the machine as a file — the
 * privacy promise extended to sharing. Conservative on purpose: patterns
 * target well-known token shapes and explicit key=value assignments, not
 * "anything long", so ordinary prose and code survive intact.
 */

const RULES: Array<{ re: RegExp; sub: string }> = [
  // Provider token shapes (well-known prefixes).
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, sub: '[redacted-key]' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/g, sub: '[redacted-key]' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, sub: '[redacted-key]' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, sub: '[redacted-key]' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, sub: '[redacted-key]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, sub: '[redacted-key]' },
  { re: /\bAIza[0-9A-Za-z_-]{30,}\b/g, sub: '[redacted-key]' },
  // JWTs (three base64url segments, first one always starts with eyJ).
  {
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
    sub: '[redacted-jwt]',
  },
  // Explicit assignments: api_key=…, "token": "…", PASSWORD='…' and the like.
  {
    re: /(\b(?:api[_-]?key|secret|token|password|passwd|credentials?)\b["']?\s*[:=]\s*["']?)[^\s"'`,;]{6,}/gi,
    sub: '$1[redacted]',
  },
  { re: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, sub: '$1[redacted]' },
  // Emails.
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, sub: '[email]' },
  // Home directories → ~ (whose machine this ran on is nobody's business).
  { re: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g, sub: '~' },
  { re: /[A-Z]:\\Users\\[A-Za-z0-9._-]+/g, sub: '~' },
];

export function redactText(s: string): string {
  let out = s;
  for (const rule of RULES) out = out.replace(rule.re, rule.sub);
  return out;
}
