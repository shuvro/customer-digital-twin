import { prisma } from '../db.js';
import type { CustomerSummary, CustomerDetail } from '../types/customer.js';

export async function listCustomers(): Promise<CustomerSummary[]> {
  const customers = await prisma.customer.findMany({
    include: {
      attributes: { where: { isCurrent: true } },
      insights: true,
      _count: { select: { messages: true } },
    },
  });

  // Fields that can have multiple concurrent current values
  const LIST_FIELDS = new Set(['email', 'phone', 'address']);

  return customers.map((c) => {
    const currentAttributes: Record<string, string | string[]> = {};
    for (const attr of c.attributes) {
      if (LIST_FIELDS.has(attr.field)) {
        // List fields accumulate into arrays
        if (!currentAttributes[attr.field]) {
          currentAttributes[attr.field] = [];
        }
        (currentAttributes[attr.field] as string[]).push(attr.valueJson ? JSON.stringify(attr.valueJson) : attr.value);
      } else {
        // Scalar fields: latest wins (only one isCurrent row)
        currentAttributes[attr.field] = attr.value;
      }
    }

    const insights: Record<string, string[]> = {};
    for (const insight of c.insights) {
      if (!insights[insight.field]) insights[insight.field] = [];
      insights[insight.field].push(insight.value);
    }

    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      dateOfBirth: c.dateOfBirth?.toISOString().split('T')[0] ?? null,
      nationality: c.nationality,
      gender: c.gender,
      taxId: c.taxId,
      currentAttributes,
      insights,
      messageCount: c._count.messages,
    };
  });
}

export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      identities: {
        orderBy: { field: 'asc' },
      },
      attributes: {
        orderBy: [{ field: 'asc' }, { messageDate: 'desc' }, { createdAt: 'desc' }],
      },
      insights: {
        orderBy: [{ field: 'asc' }, { messageDate: 'desc' }],
      },
      messages: {
        orderBy: { messageDate: 'desc' },
        select: {
          id: true,
          source: true,
          messageDate: true,
          status: true,
          confidence: true,
          matchScore: true,
        },
      },
    },
  });

  if (!customer) return null;

  // Group attributes by field with full history
  const attributes: Record<string, Array<{
    value: string;
    valueJson?: unknown;
    isCurrent: boolean;
    confidence: number;
    sourceMessageId: string;
    messageDate: string;
  }>> = {};

  for (const attr of customer.attributes) {
    if (!attributes[attr.field]) attributes[attr.field] = [];
    attributes[attr.field].push({
      value: attr.value,
      valueJson: attr.valueJson ?? undefined,
      isCurrent: attr.isCurrent,
      confidence: attr.confidence,
      sourceMessageId: attr.sourceMessageId,
      messageDate: attr.messageDate.toISOString(),
    });
  }

  // Group insights by field
  const insights: Record<string, Array<{
    value: string;
    confidence: number;
    sourceMessageId: string;
    messageDate: string;
  }>> = {};

  for (const insight of customer.insights) {
    if (!insights[insight.field]) insights[insight.field] = [];
    insights[insight.field].push({
      value: insight.value,
      confidence: insight.confidence,
      sourceMessageId: insight.sourceMessageId,
      messageDate: insight.messageDate.toISOString(),
    });
  }

  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    dateOfBirth: customer.dateOfBirth?.toISOString().split('T')[0] ?? null,
    nationality: customer.nationality,
    gender: customer.gender,
    taxId: customer.taxId,
    identityConflicts: customer.identityConflicts,
    identities: customer.identities.map((i) => ({
      field: i.field,
      value: i.value,
      confidence: i.confidence,
      sourceMessageId: i.sourceMessageId,
      messageDate: i.messageDate.toISOString(),
    })),
    attributes,
    insights,
    messages: customer.messages.map((m) => ({
      id: m.id,
      source: m.source,
      messageDate: m.messageDate.toISOString(),
      status: m.status,
      confidence: m.confidence,
      matchScore: m.matchScore,
    })),
  };
}
