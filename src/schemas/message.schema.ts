const messageObjectSchema = {
  type: 'object',
  required: ['id', 'source', 'messageDate', 'body'],
  properties: {
    id: { type: 'string', minLength: 1 },
    source: { type: 'string', minLength: 1 },
    messageDate: { type: 'string', format: 'date-time' },
    body: { type: 'string', minLength: 1 },
  },
  additionalProperties: true,
} as const;

export const postMessageSchema = {
  body: messageObjectSchema,
} as const;

export const postMessageBatchSchema = {
  body: {
    type: 'object',
    required: ['messages'],
    properties: {
      messages: {
        type: 'array',
        items: messageObjectSchema,
        minItems: 1,
      },
    },
  },
} as const;
