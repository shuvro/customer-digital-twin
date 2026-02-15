export interface InboundMessage {
  id: string;
  source: string;
  messageDate: string;
  body: string;
  // Optional fields — forward-compatible with unknown message formats
  subject?: string;
  from?: string;
  to?: string;
  channel?: string;
  documentType?: string;
  title?: string;
  [key: string]: unknown;
}
