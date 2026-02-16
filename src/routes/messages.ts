import type { FastifyInstance } from 'fastify';
import { postMessageSchema, postMessageBatchSchema } from '../schemas/message.schema.js';
import { processMessage } from '../pipeline/index.js';
import type { InboundMessage } from '../types/message.js';

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/messages', { schema: postMessageSchema }, async (request, reply) => {
    const message = request.body as InboundMessage;

    const result = await processMessage(message, request.id);

    return reply.status(200).send({
      status: 'ok',
      requestId: request.id,
      messageId: result.messageId,
      customerId: result.customerId,
      action: result.action,
      matchScore: result.score,
      matchSignals: result.signals,
    });
  });

  app.post('/messages/batch', { schema: postMessageBatchSchema }, async (request, reply) => {
    const { messages } = request.body as { messages: InboundMessage[] };
    const results = [];

    for (const message of messages) {
      try {
        const result = await processMessage(message, request.id);
        results.push({
          status: 'ok',
          messageId: result.messageId,
          customerId: result.customerId,
          action: result.action,
          matchScore: result.score,
          matchSignals: result.signals,
        });
      } catch (_err) {
        results.push({
          status: 'error',
          messageId: message.id,
          message: 'Processing failed',
        });
      }
    }

    return reply.status(200).send({ results });
  });
}
