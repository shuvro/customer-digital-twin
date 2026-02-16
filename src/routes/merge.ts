import type { FastifyInstance } from 'fastify';
import { mergeCustomers } from '../services/merge.service.js';
import { findDuplicates } from '../services/duplicates.service.js';
import { CustomerNotFoundError } from '../errors.js';

const mergeBodySchema = {
  type: 'object',
  required: ['sourceCustomerId', 'targetCustomerId'],
  properties: {
    sourceCustomerId: { type: 'string', minLength: 1 },
    targetCustomerId: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

const duplicatesQuerySchema = {
  type: 'object',
  properties: {
    minScore: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export async function mergeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/customers/merge', {
    schema: { body: mergeBodySchema },
  }, async (request, reply) => {
    const { sourceCustomerId, targetCustomerId } = request.body as {
      sourceCustomerId: string;
      targetCustomerId: string;
    };

    if (sourceCustomerId === targetCustomerId) {
      return reply.status(400).send({
        status: 'error',
        message: 'Cannot merge a customer with itself',
      });
    }

    try {
      const result = await mergeCustomers(sourceCustomerId, targetCustomerId);
      return reply.status(200).send({ status: 'ok', merge: result });
    } catch (err) {
      if (err instanceof CustomerNotFoundError) {
        return reply.status(400).send({ status: 'error', message: err.message });
      }
      throw err;
    }
  });

  app.get<{ Querystring: { minScore?: number } }>('/customers/duplicates', {
    schema: { querystring: duplicatesQuerySchema },
  }, async (request, reply) => {
    const result = await findDuplicates(request.query.minScore);
    return reply.status(200).send(result);
  });
}
