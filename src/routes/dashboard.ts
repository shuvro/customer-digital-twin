import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedHtml: string | null = null;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async (_request, reply) => {
    if (!cachedHtml) {
      const htmlPath = resolve(__dirname, '..', 'public', 'dashboard.html');
      cachedHtml = readFileSync(htmlPath, 'utf-8');
    }
    return reply.type('text/html').send(cachedHtml);
  });
}
