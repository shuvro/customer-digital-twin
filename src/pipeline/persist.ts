import { logger } from '../logger.js';
import { canonicalValue } from '../utils/normalize.js';
import type { PipelineContext } from '../types/pipeline.js';
import type { ExtractedPerson, ExtractedAddress, FieldConfidence } from '../types/extraction.js';
import { IDENTITY_FIELDS, MUTABLE_SCALAR_FIELDS, INFERRED_FIELDS } from '../types/fields.js';
import { Prisma } from '../generated/prisma/client.js';

export type TxClient = Prisma.TransactionClient;

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
  await persistImmutableFields(tx, customerId, person, sourceMessageId, messageDate, confidence, message.source);

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
  sourceType: string,
): Promise<void> {
  for (const field of IDENTITY_FIELDS) {
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
      // Conflict — keep existing, log with source lineage
      logger.warn({
        customerId,
        field,
        sourceMessageId,
        existingSource: existing.sourceMessageId,
        newSourceType: sourceType,
        existingConfidence: existing.confidence,
        newConfidence: conf,
      }, 'Immutable field conflict, keeping existing value');

      // Store conflict in Customer record with full lineage
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      const conflicts = (customer.identityConflicts as Array<Record<string, string>>) || [];
      conflicts.push({
        field,
        existingSourceMessageId: existing.sourceMessageId,
        newSourceMessageId: sourceMessageId,
        keptValue: existing.value,
        rejectedValue: value,
        newSourceType: sourceType,
        existingConfidence: String(existing.confidence),
        newConfidence: String(conf),
        detectedAt: new Date().toISOString(),
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

// SPEC rule: "When the same field appears in multiple messages, the value from
// the message with the latest messageDate wins." All historical values are
// preserved for audit, but only the latest value is marked isCurrent=true.
//
// For all mutable fields (scalar and list alike), the entry with the most
// recent messageDate is the single "current" value. Older values remain in
// the database as history but with isCurrent=false.
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

  // All entries from the latest messageDate are current.
  // This handles the case where a single message mentions multiple values
  // for the same field (e.g., two phone numbers in one message).
  const latestDate = allEntries[0].messageDate.getTime();
  const currentIds = allEntries
    .filter(e => e.messageDate.getTime() === latestDate)
    .map(e => e.id);

  await tx.customerAttribute.updateMany({
    where: { customerId, field, isCurrent: true },
    data: { isCurrent: false },
  });

  await tx.customerAttribute.updateMany({
    where: { id: { in: currentIds } },
    data: { isCurrent: true },
  });
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

    // Deduplicate normalized values — LLM may return duplicates that differ
    // only in casing/whitespace. Without dedup, the second insert would trigger
    // a P2002 which aborts the PostgreSQL transaction when using the driver adapter
    // (no savepoints), causing all subsequent operations to fail.
    const seen = new Set<string>();

    for (const rawValue of values) {
      const value = rawValue.trim().toLowerCase();
      if (!value || seen.has(value)) continue;
      seen.add(value);

      // Check existence to avoid constraint violations inside the transaction.
      // The driver adapter does not use savepoints, so a P2002 would abort
      // the entire PostgreSQL transaction — a try/catch cannot recover from it.
      const existing = await tx.customerInsight.findFirst({
        where: { customerId, field, value, sourceMessageId },
        select: { id: true },
      });
      if (existing) continue;

      await tx.customerInsight.create({
        data: { customerId, field, value, sourceMessageId, messageDate, confidence: conf },
      });
    }
  }
}
