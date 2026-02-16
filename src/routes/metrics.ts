import type { FastifyInstance } from 'fastify';
import { metrics } from '../observability/metrics.js';
import { prisma } from '../db.js';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    const [customerCount, messageCount] = await Promise.all([
      prisma.customer.count(),
      prisma.message.count(),
    ]);

    const snapshot = metrics.snapshot();

    return reply.status(200).send({
      pipeline: snapshot.counters,
      timings: snapshot.timings,
      errorRate: snapshot.errorRate,
      database: {
        customers: customerCount,
        messages: messageCount,
      },
    });
  });
}
