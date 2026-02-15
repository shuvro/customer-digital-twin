import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import addFormats from 'ajv-formats';
import { loggerConfig } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { messageRoutes } from './routes/messages.js';
import { customerRoutes } from './routes/customers.js';
import { ValidationError, LLMExtractionError, LLMParsingError } from './errors.js';
import { redactPii } from './utils/pii-redact.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: loggerConfig,
    ajv: {
      customOptions: {},
      plugins: [
        [addFormats as unknown as import('ajv').Plugin<unknown>, { mode: 'full' }],
      ],
    },
  });

  app.register(cors);

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

  return app;
}
