import pino from 'pino';
import { config } from './config.js';

export const loggerConfig = {
  level: config.logLevel,
  redact: {
    paths: [
      'body',
      'rawPayload',
      'from',
      'to',
      'req.body',
      'res.body',
    ],
    censor: '[REDACTED]',
  },
  ...(config.nodeEnv === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};

export const logger = pino(loggerConfig);
