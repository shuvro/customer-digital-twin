import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import addFormats from 'ajv-formats';
import { randomUUID } from 'node:crypto';
import { loggerConfig } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { messageRoutes } from './routes/messages.js';
import { customerRoutes } from './routes/customers.js';
import { metricsRoutes } from './routes/metrics.js';
import { mergeRoutes } from './routes/merge.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { ValidationError, LLMExtractionError, LLMParsingError } from './errors.js';
import { redactPii } from './utils/pii-redact.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: loggerConfig,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      const value = Array.isArray(header) ? header[0] : header;
      return (value && typeof value === 'string') ? value : randomUUID();
    },
    ajv: {
      customOptions: {},
      plugins: [
        [addFormats as unknown as import('ajv').Plugin<unknown>, { mode: 'full' }],
      ],
    },
  });

  app.register(cors);

  // Propagate request ID to response headers
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Global error handler — all error messages are PII-redacted before logging
  // to prevent upstream SDK/provider errors from leaking customer data.
  app.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    const log = app.log;
    const safeMsg = redactPii(error.message);

    if (error instanceof ValidationError || ('validation' in error && (error as FastifyError).validation)) {
      log.warn({ err: safeMsg }, 'Validation error');
      return reply.status(400).send({
        status: 'error',
        message: safeMsg,
      });
    }

    if (error instanceof LLMExtractionError || error instanceof LLMParsingError) {
      log.error({ err: safeMsg }, 'LLM error');
      return reply.status(502).send({
        status: 'error',
        message: 'LLM processing failed',
      });
    }

    log.error({ err: safeMsg }, 'Internal error');
    return reply.status(500).send({
      status: 'error',
      message: 'Internal server error',
    });
  });

  // Routes
  app.register(healthRoutes);
  app.register(messageRoutes, { prefix: '/api' });
  app.register(customerRoutes, { prefix: '/api' });
  app.register(metricsRoutes, { prefix: '/api' });
  app.register(mergeRoutes, { prefix: '/api' });
  app.register(dashboardRoutes);

  return app;
}
