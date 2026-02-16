import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { recalculateCurrent, type TxClient } from '../pipeline/persist.js';
import { metrics } from '../observability/metrics.js';
import { CustomerNotFoundError } from '../errors.js';
import type { Prisma } from '@prisma/client';

export interface MergeResult {
  targetCustomerId: string;
  sourceCustomerId: string;
  identitiesMoved: number;
  attributesMoved: number;
  insightsMoved: number;
  messagesMoved: number;
  identityConflicts: Array<{ field: string; keptValue: string; rejectedValue: string }>;
}

export async function mergeCustomers(sourceCustomerId: string, targetCustomerId: string): Promise<MergeResult> {
  if (sourceCustomerId === targetCustomerId) {
    throw new Error('Cannot merge a customer with itself');
  }

  // Order lock keys to prevent deadlocks
  const [firstId, secondId] = [sourceCustomerId, targetCustomerId].sort();
  const lockKey1 = hashText(firstId);
  const lockKey2 = hashText(secondId);

  const result = await prisma.$transaction(async (tx) => {
    // Advisory locks in deterministic order
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey1})`);
    if (lockKey1 !== lockKey2) {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey2})`);
    }

    // Verify both customers exist
    const [source, target] = await Promise.all([
      tx.customer.findUnique({ where: { id: sourceCustomerId } }),
      tx.customer.findUnique({ where: { id: targetCustomerId } }),
    ]);

    if (!source) throw new CustomerNotFoundError(sourceCustomerId);
    if (!target) throw new CustomerNotFoundError(targetCustomerId);

    const identityConflicts: MergeResult['identityConflicts'] = [];

    // --- Move identities (Layer 1: Immutable) ---
    const sourceIdentities = await tx.customerIdentity.findMany({
      where: { customerId: sourceCustomerId },
    });

    let identitiesMoved = 0;
    for (const identity of sourceIdentities) {
      const targetIdentity = await tx.customerIdentity.findUnique({
        where: { customerId_field: { customerId: targetCustomerId, field: identity.field } },
      });

      if (targetIdentity) {
        if (targetIdentity.value === identity.value) {
          // Same value — delete source copy
          await tx.customerIdentity.delete({ where: { id: identity.id } });
        } else {
          // Different value — target wins, log conflict
          identityConflicts.push({
            field: identity.field,
            keptValue: targetIdentity.value,
            rejectedValue: identity.value,
          });
          await tx.customerIdentity.delete({ where: { id: identity.id } });
        }
      } else {
        // Target doesn't have this field — move it
        await tx.customerIdentity.update({
          where: { id: identity.id },
          data: { customerId: targetCustomerId },
        });
        identitiesMoved++;
      }
    }

    // Store merge identity conflicts on target
    if (identityConflicts.length > 0) {
      const existing = (target.identityConflicts as Array<Record<string, string>>) || [];
      const newConflicts = identityConflicts.map((c) => ({
        ...c,
        type: 'merge',
        sourceCustomerId,
      }));
      await tx.customer.update({
        where: { id: targetCustomerId },
        data: {
          identityConflicts: [...existing, ...newConflicts] as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // --- Move attributes (Layer 2: Mutable) ---
    const sourceAttributes = await tx.customerAttribute.findMany({
      where: { customerId: sourceCustomerId },
    });

    let attributesMoved = 0;
    const affectedFields = new Set<string>();
    for (const attr of sourceAttributes) {
      try {
        await tx.customerAttribute.update({
          where: { id: attr.id },
          data: { customerId: targetCustomerId },
        });
        attributesMoved++;
        affectedFields.add(attr.field);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          // Exact duplicate already exists on target — delete source
          await tx.customerAttribute.delete({ where: { id: attr.id } });
          affectedFields.add(attr.field);
        } else {
          throw err;
        }
      }
    }

    // Recalculate isCurrent for all affected fields
    for (const field of affectedFields) {
      await recalculateCurrent(tx as unknown as TxClient, targetCustomerId, field);
    }

    // --- Move insights (Layer 3: Inferred) ---
    const sourceInsights = await tx.customerInsight.findMany({
      where: { customerId: sourceCustomerId },
    });

    let insightsMoved = 0;
    for (const insight of sourceInsights) {
      try {
        await tx.customerInsight.update({
          where: { id: insight.id },
          data: { customerId: targetCustomerId },
        });
        insightsMoved++;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          await tx.customerInsight.delete({ where: { id: insight.id } });
        } else {
          throw err;
        }
      }
    }

    // --- Move messages ---
    const messagesResult = await tx.message.updateMany({
      where: { customerId: sourceCustomerId },
      data: { customerId: targetCustomerId },
    });

    // Update denormalized fields on target from merged identities
    await updateDenormalizedFields(tx as unknown as TxClient, targetCustomerId);

    // Delete the source customer
    await tx.customer.delete({ where: { id: sourceCustomerId } });

    return {
      targetCustomerId,
      sourceCustomerId,
      identitiesMoved,
      attributesMoved,
      insightsMoved,
      messagesMoved: messagesResult.count,
      identityConflicts,
    };
  }, { timeout: 30000 });

  metrics.increment('customersMerged');
  logger.info({ sourceCustomerId, targetCustomerId }, 'Customers merged');

  return result;
}

async function updateDenormalizedFields(tx: TxClient, customerId: string): Promise<void> {
  const identities = await tx.customerIdentity.findMany({
    where: { customerId },
  });

  const updateData: Record<string, unknown> = {};
  for (const identity of identities) {
    if (identity.field === 'dateOfBirth') {
      updateData[identity.field] = new Date(identity.value);
    } else {
      updateData[identity.field] = identity.value;
    }
  }

  if (Object.keys(updateData).length > 0) {
    await tx.customer.update({ where: { id: customerId }, data: updateData });
  }
}

function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
