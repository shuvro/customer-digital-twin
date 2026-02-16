import type { FastifyInstance } from 'fastify';
import { postMessageSchema, postMessageBatchSchema } from '../schemas/message.schema.js';
import { getPipelineSchema } from '../schemas/pipeline.schema.js';
import { processMessage } from '../pipeline/index.js';
import { prisma } from '../db.js';
import type { InboundMessage } from '../types/message.js';
import { logger } from '../logger.js';
import { toErrorMessage } from '../utils/errors.js';

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
      } catch (err) {
        logger.warn({ messageId: message.id, error: toErrorMessage(err) }, 'Batch message processing failed');
        results.push({
          status: 'error',
          messageId: message.id,
          message: 'Processing failed',
        });
      }
    }

    return reply.status(200).send({ results });
  });

  app.get('/messages/:id/pipeline', { schema: getPipelineSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        pipelineLogs: {
          orderBy: { sequence: 'asc' },
        },
      },
    });

    if (!message) {
      return reply.status(404).send({
        status: 'error',
        message: 'Message not found',
      });
    }

    return reply.status(200).send({
      messageId: message.id,
      status: message.status,
      customerId: message.customerId,
      decisionCode: message.decisionCode,
      decisionReasoning: message.decisionReasoning,
      pipeline: message.pipelineLogs.map(log => ({
        stage: log.stage,
        sequence: log.sequence,
        timestamp: log.timestamp.toISOString(),
        durationMs: log.durationMs,
        summary: log.summary,
        input: log.input,
        output: log.output,
      })),
    });
  });
}
