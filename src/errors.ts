export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class LLMExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMExtractionError';
  }
}

export class LLMParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMParsingError';
  }
}

export class CustomerNotFoundError extends Error {
  constructor(public readonly customerId: string) {
    super(`Customer ${customerId} not found`);
    this.name = 'CustomerNotFoundError';
  }
}
