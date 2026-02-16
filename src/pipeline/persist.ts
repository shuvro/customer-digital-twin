import { logger } from '../logger.js';
import { canonicalValue } from '../utils/normalize.js';
import type { PipelineContext } from '../types/pipeline.js';
import type { ExtractedPerson, ExtractedAddress, FieldConfidence } from '../types/extraction.js';
import type { Prisma, PrismaClient } from '@prisma/client';

export type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// Fields classified by data layer
const IMMUTABLE_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'nationality', 'gender', 'taxId'] as const;
const MUTABLE_SCALAR_FIELDS = ['maritalStatus', 'occupation', 'employer'] as const;
const INFERRED_FIELDS = ['communicationPreferences', 'hobbies', 'needs', 'riskIndicators', 'familyContext', 'notes'] as const;

/**
 * Persist extraction results into the three-layer data model.
 * Accepts a transaction client so it can participate in the caller's transaction.
 */
export async function persistExtraction(ctx: PipelineContext, tx: TxClient): Promise<string> {
  const { person, decision, message, extraction } = ctx;
  if (!person || !decision) throw new Error('Missing person or decision in pipeline context');

  const messageDate = new Date(message.messageDate);
  const sourceMessageId = message.id;
  const confidence = extraction?.confidence ?? {};

  let customerId: string;

  if (decision.action === 'CREATE') {
    const customer = await tx.customer.create({ data: {} });
    customerId = customer.id;
    logger.info({ customerId, messageId: sourceMessageId }, 'Created new customer');
  } else if (decision.action === 'UPDATE' && decision.customerId) {
    customerId = decision.customerId;
  } else {
    throw new Error(`Invalid decision: ${decision.action}`);
  }

  // Link message to customer
  await tx.message.update({
    where: { id: sourceMessageId },
    data: { customerId },
  });

  // Layer 1: Immutable identity fields
  await persistImmutableFields(tx, customerId, person, sourceMessageId, messageDate, confidence);

  // Layer 2: Mutable attributes (scalars)
  await persistMutableScalars(tx, customerId, person, sourceMessageId, messageDate, confidence);

  // Layer 2: Mutable attributes (arrays — emails, phones, addresses)
  await persistMutableArrays(tx, customerId, person, sourceMessageId, messageDate, confidence);

  // Layer 3: Inferred insights
  await persistInsights(tx, customerId, person, sourceMessageId, messageDate, confidence);

  return customerId;
}

async function persistImmutableFields(
  tx: TxClient,
  customerId: string,
  person: ExtractedPerson,
  sourceMessageId: string,
  messageDate: Date,
  fieldConfidence: FieldConfidence,
): Promise<void> {
  for (const field of IMMUTABLE_FIELDS) {
    const raw = person[field];
    if (raw === null || raw === undefined) continue;

    const value = field === 'dateOfBirth' ? String(raw) : canonicalValue(raw);
    if (!value) continue;

    const conf = fieldConfidence[field] ?? 1.0;

    // Try to find existing identity for this field
    const existing = await tx.customerIdentity.findUnique({
      where: { customerId_field: { customerId, field } },
    });

    if (!existing) {
      // Create new identity entry
      await tx.customerIdentity.create({
        data: { customerId, field, value, sourceMessageId, messageDate, confidence: conf },
      });

      // Update denormalized field on Customer
      const updateData: Record<string, unknown> = {};
      if (field === 'dateOfBirth') {
        updateData[field] = new Date(value);
      } else {
        updateData[field] = value;
      }
      await tx.customer.update({ where: { id: customerId }, data: updateData });
    } else if (existing.value === value) {
      // Same value — idempotent, skip
    } else {
      // Conflict — keep existing, log
      logger.warn({
        customerId,
        field,
        sourceMessageId,
        existingSource: existing.sourceMessageId,
      }, 'Immutable field conflict, keeping existing value');

      // Store conflict in Customer record
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      const conflicts = (customer.identityConflicts as Array<Record<string, string>>) || [];
      conflicts.push({
        field,
        existingSourceMessageId: existing.sourceMessageId,
        newSourceMessageId: sourceMessageId,
        keptValue: existing.value,
        rejectedValue: value,
      });
      await tx.customer.update({
        where: { id: customerId },
        data: { identityConflicts: conflicts as unknown as Prisma.InputJsonValue },
      });
    }
  }
}

async function persistMutableScalars(
  tx: TxClient,
  customerId: string,
  person: ExtractedPerson,
  sourceMessageId: string,
  messageDate: Date,
  fieldConfidence: FieldConfidence,
): Promise<void> {
  for (const field of MUTABLE_SCALAR_FIELDS) {
    const raw = person[field];
    if (raw === null || raw === undefined) continue;

    const value = canonicalValue(raw);
    if (!value) continue;

    const conf = fieldConfidence[field] ?? 1.0;
    await upsertAttribute(tx, customerId, field, value, null, sourceMessageId, messageDate, conf);
  }
}

async function persistMutableArrays(
  tx: TxClient,
  customerId: string,
  person: ExtractedPerson,
  sourceMessageId: string,
  messageDate: Date,
  fieldConfidence: FieldConfidence,
): Promise<void> {
  // Emails
  if (person.emails) {
    const conf = fieldConfidence['emails'] ?? 1.0;
    for (const email of person.emails) {
      const value = canonicalValue(email);
      if (value) {
        await upsertAttribute(tx, customerId, 'email', value, null, sourceMessageId, messageDate, conf);
      }
    }
  }

  // Phones
  if (person.phones) {
    const conf = fieldConfidence['phones'] ?? 1.0;
    for (const phone of person.phones) {
      const value = canonicalValue(phone);
      if (value) {
        await upsertAttribute(tx, customerId, 'phone', value, null, sourceMessageId, messageDate, conf);
      }
    }
  }

  // Addresses
  if (person.addresses) {
    const conf = fieldConfidence['addresses'] ?? 1.0;
    for (const addr of person.addresses) {
      await persistAddress(tx, customerId, addr, sourceMessageId, messageDate, conf);
    }
  }
}

async function persistAddress(
  tx: TxClient,
  customerId: string,
  addr: ExtractedAddress,
  sourceMessageId: string,
  messageDate: Date,
  confidence: number = 1.0,
): Promise<void> {
  // Canonical text for the unique constraint
  const addrObj: Record<string, string> = {};
  if (addr.street) addrObj.street = addr.street.trim();
  if (addr.city) addrObj.city = addr.city.trim();
  if (addr.postalCode) addrObj.postalCode = addr.postalCode.trim();
  if (addr.country) addrObj.country = addr.country.trim();
  if (addr.fullAddress) addrObj.fullAddress = addr.fullAddress.trim();

  const value = canonicalValue(addrObj);
  if (!value || value === '{}') return;

  await upsertAttribute(tx, customerId, 'address', value, addrObj, sourceMessageId, messageDate, confidence);
}

async function upsertAttribute(
  tx: TxClient,
  customerId: string,
  field: string,
  value: string,
  valueJson: Record<string, string> | null,
  sourceMessageId: string,
  messageDate: Date,
  confidence: number = 1.0,
): Promise<void> {
  // Check for existing duplicate (idempotency)
  const existing = await tx.customerAttribute.findFirst({
    where: { customerId, field, sourceMessageId, messageDate, value },
  });

  if (existing) return; // Already exists from this source — skip

  // Insert new attribute
  await tx.customerAttribute.create({
    data: {
      customerId,
      field,
      value,
      valueJson: valueJson as unknown as Prisma.InputJsonValue ?? undefined,
      isCurrent: false,
      sourceMessageId,
      messageDate,
      confidence,
    },
  });

  // Recalculate isCurrent for this (customerId, field)
  await recalculateCurrent(tx, customerId, field);
}

// List-type fields can have multiple concurrent "current" values.
//
// DESIGN DECISION: For an insurance company, contact information accumulates —
// a customer's second email doesn't invalidate the first. All distinct values
// ever seen are kept as "current" (the latest entry per value is the canonical one).
// This ensures no reachable contact point is ever lost.
//
// Alternative interpretation: "latest messageDate wins" could mean only values
// from the most recent message are current. We chose accumulation because:
//   1. Insurance requires maximum customer reachability
//   2. A message mentioning one email doesn't imply others are invalid
//   3. Full history is preserved regardless, so switching behavior is trivial
//
// Scalar mutable fields (maritalStatus, occupation, employer) follow strict
// "latest messageDate wins" — only one value is current at a time.
export const LIST_FIELDS = new Set(['email', 'phone', 'address']);

export async function recalculateCurrent(
  tx: TxClient,
  customerId: string,
  field: string,
): Promise<void> {
  const allEntries = await tx.customerAttribute.findMany({
    where: { customerId, field },
    orderBy: [
      { messageDate: 'desc' },
      { createdAt: 'desc' },
      { sourceMessageId: 'desc' },
    ],
  });

  if (allEntries.length === 0) return;

  if (LIST_FIELDS.has(field)) {
    // For list fields: each distinct value from the latest message that mentions it is current.
    // All unique values ever seen are kept current (accumulated over time).
    // We mark all entries as current since each represents a distinct value
    // (uniqueness is enforced by the DB constraint on customerId+field+sourceMessageId+messageDate+value).
    const currentIds = new Set<string>();
    const seenValues = new Set<string>();
    for (const entry of allEntries) {
      if (!seenValues.has(entry.value)) {
        seenValues.add(entry.value);
        currentIds.add(entry.id);
      }
    }

    // Set all to not current first
    await tx.customerAttribute.updateMany({
      where: { customerId, field, isCurrent: true },
      data: { isCurrent: false },
    });

    // Mark the latest entry for each distinct value as current
    if (currentIds.size > 0) {
      await tx.customerAttribute.updateMany({
        where: { id: { in: [...currentIds] } },
        data: { isCurrent: true },
      });
    }
  } else {
    // For scalar fields: only the latest value is current
    const currentId = allEntries[0].id;

    await tx.customerAttribute.updateMany({
      where: { customerId, field, isCurrent: true },
      data: { isCurrent: false },
    });

    await tx.customerAttribute.update({
      where: { id: currentId },
      data: { isCurrent: true },
    });
  }
}

async function persistInsights(
  tx: TxClient,
  customerId: string,
  person: ExtractedPerson,
  sourceMessageId: string,
  messageDate: Date,
  fieldConfidence: FieldConfidence,
): Promise<void> {
  for (const field of INFERRED_FIELDS) {
    const values = person[field] as string[] | undefined;
    if (!values || values.length === 0) continue;

    const conf = fieldConfidence[field] ?? 0.7;

    for (const rawValue of values) {
      const value = rawValue.trim().toLowerCase();
      if (!value) continue;

      try {
        await tx.customerInsight.create({
          data: { customerId, field, value, sourceMessageId, messageDate, confidence: conf },
        });
      } catch (err) {
        // P2002 = unique constraint violation → already exists, skip silently
        if ((err as { code?: string }).code === 'P2002') {
          continue;
        }
        throw err;
      }
    }
  }
}
