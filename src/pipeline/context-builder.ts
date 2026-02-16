import { prisma } from '../db.js';
import { extractFieldValues, extractScalarField } from '../utils/extraction-helpers.js';
import { formatDateAsISO } from '../utils/normalize.js';

export interface CustomerContext {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  taxId: string | null;
  nationality: string | null;
  gender: string | null;
  emails: string[];
  phones: string[];
  addresses: string[];
  occupation: string | null;
  employer: string | null;
  maritalStatus: string | null;
}

export async function buildCustomerContext(customerId: string): Promise<CustomerContext> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: {
      attributes: {
        where: { isCurrent: true },
      },
    },
  });

  const attrs = customer.attributes;

  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    dateOfBirth: formatDateAsISO(customer.dateOfBirth),
    taxId: customer.taxId,
    nationality: customer.nationality,
    gender: customer.gender,
    emails: extractFieldValues(attrs, 'email'),
    phones: extractFieldValues(attrs, 'phone'),
    addresses: extractFieldValues(attrs, 'address'),
    occupation: extractScalarField(attrs, 'occupation'),
    employer: extractScalarField(attrs, 'employer'),
    maritalStatus: extractScalarField(attrs, 'maritalStatus'),
  };
}
