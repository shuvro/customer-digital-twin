import type { InboundMessage } from '../types/message.js';
import type { CustomerContext } from '../pipeline/context-builder.js';
import { buildUserPrompt } from './prompts.js';

export function buildContextEnhancedUserPrompt(message: InboundMessage, context: CustomerContext): string {
  const lines: string[] = [];

  lines.push('=== KNOWN CUSTOMER CONTEXT ===');
  lines.push('The following is the current profile of an existing customer that likely matches the person in this message.');
  lines.push('');
  lines.push('Use this context to:');
  lines.push('- Resolve name ambiguities: "Maria" likely refers to "María García López" if context matches');
  lines.push('- Complete partial data: a city name alone can be matched to a known address');
  lines.push('- Disambiguate contacts: if the message mentions a phone number, check if it updates or confirms a known one');
  lines.push('- Increase confidence: if extracted data MATCHES the known profile, set confidence to 1.0');
  lines.push('- Flag discrepancies: if extracted data CONTRADICTS the known profile (e.g., different DOB), still extract it but set lower confidence (0.5-0.7)');
  lines.push('');
  lines.push('IMPORTANT: Still extract ALL fields mentioned in the message — do not omit fields just because they already exist in the profile.');
  lines.push('');

  if (context.firstName || context.lastName) {
    lines.push(`Name: ${[context.firstName, context.lastName].filter(Boolean).join(' ')}`);
  }
  if (context.dateOfBirth) lines.push(`Date of Birth: ${context.dateOfBirth}`);
  if (context.taxId) lines.push(`Tax ID: ${context.taxId}`);
  if (context.nationality) lines.push(`Nationality: ${context.nationality}`);
  if (context.gender) lines.push(`Gender: ${context.gender}`);

  if (context.emails.length > 0) lines.push(`Known Emails: ${context.emails.join(', ')}`);
  if (context.phones.length > 0) lines.push(`Known Phones: ${context.phones.join(', ')}`);
  if (context.addresses.length > 0) lines.push(`Known Addresses: ${context.addresses.join('; ')}`);

  if (context.occupation) lines.push(`Occupation: ${context.occupation}`);
  if (context.employer) lines.push(`Employer: ${context.employer}`);
  if (context.maritalStatus) lines.push(`Marital Status: ${context.maritalStatus}`);

  lines.push('=== END CUSTOMER CONTEXT ===');
  lines.push('');

  lines.push(buildUserPrompt(message));

  return lines.join('\n');
}
