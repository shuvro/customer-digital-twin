import { buildApp } from './app.js';
import { config } from './config.js';
import { disconnectDb } from './db.js';

const app = buildApp();

async function start(): Promise<void> {
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    await disconnectDb();
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  app.log.info('Shutting down...');
  await app.close();
  await disconnectDb();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
