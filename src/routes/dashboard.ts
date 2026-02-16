import type { FastifyInstance } from 'fastify';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

let cachedHtml: string | null = null;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => {
    return reply.redirect('/dashboard');
  });

  app.get('/dashboard', async (_request, reply) => {
    if (!cachedHtml) {
      const htmlPath = resolve(__dirname, '..', 'public', 'dashboard.html');
      cachedHtml = readFileSync(htmlPath, 'utf-8');
    }
    return reply.type('text/html').send(cachedHtml);
  });

  app.get('/dataset', async (_request, reply) => {
    const datasetRoot = resolve(__dirname, '..', '..', 'dataset');
    const messages: unknown[] = [];

    try {
      const subdirs = readdirSync(datasetRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();

      for (const subdir of subdirs) {
        const dirPath = join(datasetRoot, subdir);
        const files = readdirSync(dirPath).filter(f => f.endsWith('.json')).sort();
        for (const file of files) {
          const content = readFileSync(join(dirPath, file), 'utf-8');
          messages.push(JSON.parse(content));
        }
      }
    } catch {
      // dataset directory may not exist
    }

    return reply.send({ messages, count: messages.length });
  });
}
