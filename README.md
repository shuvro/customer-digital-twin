# Customer Digital Twin

An AI-powered pipeline that ingests unstructured data (emails, chat messages, documents), extracts customer information via LLM, and maintains living customer profiles with full history tracking.

## Architecture

```
POST /api/messages
        │
        ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Extract    │────▶│    Search    │────▶│    Decide    │────▶│   Persist    │
│  (LLM call)  │     │(fuzzy match) │     │(create/update)│    │ (3-layer DB) │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

**Four-stage pipeline:**

1. **Extract** — LLM parses unstructured text into structured fields (name, DOB, tax ID, emails, phones, addresses, hobbies, etc.)
2. **Search** — Fuzzy-matches extracted data against existing customers using Jaro-Winkler similarity + composite weighted scoring (taxId, email, phone, name, DOB)
3. **Decide** — Determines whether to CREATE a new customer or UPDATE an existing one based on match score thresholds
4. **Persist** — Writes data into a three-layer model inside a Prisma transaction

### Three-Layer Data Model

| Layer | Fields | Behavior |
|---|---|---|
| **Immutable** | firstName, lastName, dateOfBirth, nationality, gender, taxId | Set once, never overwritten. Conflicts are logged for audit. |
| **Mutable** | emails, phones, addresses, maritalStatus, occupation, employer | Latest `messageDate` wins for scalars. List fields (email, phone, address) accumulate all distinct values. Full history preserved. |
| **Inferred** | hobbies, needs, riskIndicators, communicationPreferences, familyContext, notes | Accumulated across messages. Never overwritten or deleted. |

### Design Decisions

- **No format-specific parsing** — The pipeline is fully format-agnostic. The LLM handles all extraction from any text format.
- **Session-level advisory locks** (`pg_advisory_lock`) held inside a single `$transaction` callback for safe idempotency. The lock spans the entire pipeline (extract through persist), ensuring no duplicate processing even under concurrent requests. Lock and unlock use the same pooled connection.
- **`messageDate`-based conflict resolution** — Scalar mutable fields (maritalStatus, occupation, employer): the value from the most recent `messageDate` wins, with one current value at a time. Non-chronological message arrival is handled correctly.
- **List field accumulation** — Contact fields (email, phone, address) accumulate all distinct values as "current". In an insurance context, a customer's second email doesn't invalidate the first — all known contact points are preserved. Each distinct value's latest entry (by `messageDate`) is the canonical one, with full history retained.
- **Custom LLM pipeline** — OpenAI SDK with retry + model fallback (primary: `gpt-oss-120b`, fallback: `Kimi-K2.5`), no framework dependencies.

## Tech Stack

- **Runtime**: TypeScript + Node.js
- **HTTP**: Fastify (JSON Schema validation with ajv-formats)
- **Database**: PostgreSQL 16
- **ORM**: Prisma
- **LLM**: OpenAI SDK pointing to Nebius AI Platform
- **Testing**: Vitest
- **Infrastructure**: Docker + Docker Compose

## Setup

### Prerequisites

- Docker and Docker Compose
- `NEBIUS_API_KEY` environment variable

### Quick Start

```bash
# Set your API key
export NEBIUS_API_KEY=your-key-here

# Start everything (app + database)
docker compose up --build

# In another terminal, ingest the 15 sample messages
make ingest
```

The service starts on `http://localhost:3000`. Health check: `GET /health`.

### Local Development

```bash
make install          # npm ci
make db-up            # start PostgreSQL only
make db-migrate       # apply Prisma migrations
make dev              # hot-reload dev server (tsx watch)
make test             # run all tests
make verify           # typecheck + tests + build
```

## API Documentation

### POST /api/messages

Ingest a single unstructured message.

**Request:**

```json
{
  "id": "msg-001",
  "source": "email",
  "messageDate": "2025-01-15T10:30:00Z",
  "body": "My name is María García López. Tax ID: 12345678A..."
}
```

**Response (200):**

```json
{
  "status": "ok",
  "messageId": "msg-001",
  "customerId": "cm5abc123",
  "action": "CREATE",
  "matchScore": 0,
  "matchSignals": []
}
```

**Action values:** `CREATE` (new customer), `UPDATE` (matched existing), `SKIP` (no person extracted), `ALREADY_PROCESSED` (idempotent replay), `ALREADY_PROCESSING` (concurrent request is handling this message).

**Validation errors (400):** Returned for missing required fields or invalid `messageDate` format (must be ISO 8601).

### POST /api/messages/batch

Ingest multiple messages in one request.

**Request:**

```json
{
  "messages": [
    { "id": "msg-001", "source": "email", "messageDate": "2025-01-15T10:30:00Z", "body": "..." },
    { "id": "msg-002", "source": "chat", "messageDate": "2025-02-01T14:00:00Z", "body": "..." }
  ]
}
```

**Response (200):**

```json
{
  "results": [
    { "status": "ok", "messageId": "msg-001", "customerId": "cm5abc123", "action": "CREATE", "matchScore": 0, "matchSignals": [] },
    { "status": "ok", "messageId": "msg-002", "customerId": "cm5abc123", "action": "UPDATE", "matchScore": 1.0, "matchSignals": ["taxId"] }
  ]
}
```

### GET /api/customers

List all customer profiles with current attribute values.

**Response (200):**

```json
{
  "customers": [
    {
      "id": "cm5abc123",
      "firstName": "María",
      "lastName": "García López",
      "dateOfBirth": "1985-03-14",
      "nationality": "Spanish",
      "gender": "Female",
      "taxId": "12345678A",
      "currentAttributes": {
        "email": ["m.garcia85@gmail.com", "maria.garcia@email.com"],
        "phone": ["+34 612 345 678", "+49 171 2345678"],
        "address": ["{\"city\":\"Munich\",\"country\":\"Germany\",...}"],
        "maritalStatus": "Married",
        "occupation": "Senior Software Engineer",
        "employer": "TechCorp GmbH"
      },
      "insights": {
        "hobbies": ["hiking", "cooking"],
        "needs": ["life insurance"],
        "familyContext": ["has stepchildren"]
      },
      "messageCount": 8
    }
  ]
}
```

### GET /api/customers/:id

Full customer detail with complete attribute history and linked messages.

### GET /health

Returns `{ "status": "ok" }`.

## Testing

```bash
make test              # all tests
make test-unit         # unit tests only
make test-integration  # integration tests (requires PostgreSQL)
make test-e2e          # end-to-end dataset test
make test-coverage     # with coverage report
```

Tests use mocked LLM responses to be deterministic and fast. Integration and E2E tests require a running PostgreSQL (via `make db-up`).

## Project Structure

```
src/
  pipeline/          # 4-stage extraction pipeline (extract, search, decide, persist)
  llm/               # OpenAI SDK client, prompts, JSON parser, retry logic
  matching/          # Jaro-Winkler fuzzy matching + composite scorer
  routes/            # Fastify route handlers (messages, customers, health)
  services/          # Customer profile assembly
  schemas/           # Input validation (Fastify JSON Schema + Zod for LLM output)
  types/             # TypeScript interfaces
  utils/             # Normalization + PII redaction
prisma/              # Database schema + migrations
dataset/             # 15 sample messages (5 emails, 5 messages, 5 documents)
tests/               # Unit, integration, and E2E tests
```
