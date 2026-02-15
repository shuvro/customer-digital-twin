const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';

// Validate required env vars at startup (skip during tests where LLM is mocked)
if (!isTest && !process.env.NEBIUS_API_KEY) {
  console.error('FATAL: NEBIUS_API_KEY environment variable is required but not set.');
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/digital_twin?schema=public',

  nebius: {
    apiKey: process.env.NEBIUS_API_KEY || '',
    primary: {
      model: 'openai/gpt-oss-120b',
      baseURL: 'https://api.tokenfactory.nebius.com/v1/',
    },
    fallback: {
      model: 'moonshotai/Kimi-K2.5',
      baseURL: 'https://api.tokenfactory.eu-west1.nebius.com/v1/',
    },
    temperature: 0.1,
    maxRetries: 3,
    retryBaseDelayMs: 2000,
  },

  matching: {
    highThreshold: 0.7,
    lowThreshold: 0.4,
    minSignalsForMedium: 1,
  },
} as const;
