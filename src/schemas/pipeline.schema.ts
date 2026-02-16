const stageSummarySchema = {
  type: ['object', 'null'],
  additionalProperties: true,
  properties: {
    // ExtractSummary
    personCount: { type: 'number' },
    fieldsExtracted: { type: 'array', items: { type: 'string' } },
    avgConfidence: { type: 'number' },
    // SearchSummary
    candidateCount: { type: 'number' },
    bestScore: { type: 'number' },
    bestSignals: { type: 'array', items: { type: 'string' } },
    directLookupHits: { type: 'number' },
    // ReExtractSummary
    triggered: { type: 'boolean' },
    fieldsChanged: { type: 'array', items: { type: 'string' } },
    fieldsAdded: { type: 'array', items: { type: 'string' } },
    mergeStrategy: { type: 'string' },
    // DecideSummary
    action: { type: 'string' },
    decisionCode: { type: 'string' },
    score: { type: 'number' },
    signals: { type: 'array', items: { type: 'string' } },
    // PersistSummary
    customerId: { type: 'string' },
    identitiesWritten: { type: 'number' },
    attributesWritten: { type: 'number' },
    insightsWritten: { type: 'number' },
    // ErrorSummary
    stage: { type: 'string' },
    errorType: { type: 'string' },
    errorMessage: { type: 'string' },
  },
} as const;

export const getPipelineSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        status: { type: 'string' },
        customerId: { type: ['string', 'null'] },
        decisionCode: { type: ['string', 'null'] },
        decisionReasoning: { type: ['string', 'null'] },
        pipeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stage: { type: 'string' },
              sequence: { type: 'number' },
              timestamp: { type: 'string', format: 'date-time' },
              durationMs: { type: ['number', 'null'] },
              summary: { type: 'string' },
              input: stageSummarySchema,
              output: stageSummarySchema,
            },
          },
        },
      },
    },
    404: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
} as const;
