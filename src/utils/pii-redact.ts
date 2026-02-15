const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+\d[\d\s\-()]{6,}\d|\b\d[\d\s\-()]{8,}\d\b)/g;
const DATE_RE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g;
const TAX_ID_SPANISH_RE = /\b\d{8}[A-Za-z]\b/g;

export function redactPii(text: string): string {
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(TAX_ID_SPANISH_RE, '[TAXID]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(DATE_RE, '[DATE]');
}
