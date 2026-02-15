import { z } from 'zod';

const addressSchema = z.object({
  street: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  fullAddress: z.string().optional().nullable(),
}).passthrough();

const personSchema = z.object({
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
}).passthrough();

export const extractionResultSchema = z.object({
  persons: z.array(personSchema).min(0).default([]),
  confidence: z.record(z.string(), z.number()).optional().default({}),
}).passthrough();

export type ZodExtractionResult = z.infer<typeof extractionResultSchema>;
export type ZodExtractedPerson = z.infer<typeof personSchema>;
