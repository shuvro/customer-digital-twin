import { z } from 'zod';

// z.looseObject() is the Zod 4 equivalent of z.object({}).passthrough().
// It validates known keys while allowing unknown keys to pass through — needed
// because LLM responses may include extra fields we don't want to strip.

const addressSchema = z.looseObject({
  street: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  fullAddress: z.string().optional().nullable(),
});

const personSchema = z.looseObject({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  taxId: z.string().optional().nullable(),
  maritalStatus: z.string().optional().nullable(),
  occupation: z.string().optional().nullable(),
  employer: z.string().optional().nullable(),
  addresses: z.array(addressSchema).optional().default([]),
  emails: z.array(z.string()).optional().default([]),
  phones: z.array(z.string()).optional().default([]),
  communicationPreferences: z.array(z.string()).optional().default([]),
  hobbies: z.array(z.string()).optional().default([]),
  needs: z.array(z.string()).optional().default([]),
  riskIndicators: z.array(z.string()).optional().default([]),
  familyContext: z.array(z.string()).optional().default([]),
  notes: z.array(z.string()).optional().default([]),
});

export const extractionResultSchema = z.looseObject({
  persons: z.array(personSchema).min(0).default([]),
  confidence: z.record(z.string(), z.number()).optional().default({}),
});

export type ZodExtractionResult = z.infer<typeof extractionResultSchema>;
export type ZodExtractedPerson = z.infer<typeof personSchema>;
