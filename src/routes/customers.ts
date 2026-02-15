import type { FastifyInstance } from 'fastify';
import { listCustomers, getCustomerDetail } from '../services/customer.service.js';

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customers', async (_request, reply) => {
    const customers = await listCustomers();
    return reply.status(200).send({ customers });
  });

  app.get<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    const { id } = request.params;
    const customer = await getCustomerDetail(id);

    if (!customer) {
      return reply.status(404).send({ status: 'error', message: 'Customer not found' });
    }

    return reply.status(200).send({ customer });
  });
}
