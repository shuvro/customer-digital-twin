# Customer Digital Twin

An AI-powered pipeline that ingests unstructured data (emails, chat messages, documents), extracts customer information via LLM, and maintains living customer profiles with full history tracking and source lineage.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Design Decisions](#design-decisions)
- [Data Model Design](#data-model-design)
- [Setup Instructions](#setup-instructions)
- [API Documentation](#api-documentation)
- [Processed Results](#processed-results)
- [Testing](#testing)
- [Project Structure](#project-structure)

---

## Architecture Overview

### Pipeline Flow

```
POST /api/messages
        │
        ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Extract    │────▶│    Search    │────▶│  Re-Extract  │────▶│    Decide    │────▶│   Persist    │
│  (LLM call)  │     │(fuzzy match) │     │ (w/ context) │     │(create/update)│    │ (3-layer DB) │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                                          │
                                                                                          ▼
                                                                                   ┌──────────────┐
                                                                                   │ Pipeline Log │
                                                                                   │  (audit DB)  │
                                                                                   └──────────────┘
```

**Five-stage pipeline** (orchestrated in `src/pipeline/index.ts`):

1. **Extract** — LLM parses unstructured text into structured `ExtractedPerson` fields (name, DOB, tax ID, emails, phones, addresses, hobbies, risk indicators, etc.). Uses a detailed system prompt with extraction rules for names, dates, tax IDs, phones, and confidence scoring.
2. **Search** — Fuzzy-matches extracted data against all existing customers using Jaro-Winkler similarity with composite weighted scoring (taxId, email, phone, name, DOB). Direct lookups on exact-match fields (taxId, email, phone) are performed first, then fuzzy scoring ranks all candidates.
3. **Re-Extract** (context-enhanced) — When a high-confidence match is found, the pipeline re-extracts with the matched customer's known profile injected as context. This allows the LLM to resolve name ambiguities ("Maria" → "María García López"), complete partial data, and calibrate confidence scores. The re-extraction result is merged with the original extraction.
4. **Decide** — Applies a decision tree: exact taxId match → UPDATE; composite score ≥ 0.7 → UPDATE; score ≥ 0.4 with 2+ matching signals → UPDATE; otherwise CREATE. Each decision is logged with a human-readable `reasoning` and machine-parsable `decisionCode`.
5. **Persist** — Writes data into the three-layer model inside a Prisma transaction with PostgreSQL advisory locks for idempotency. Every pipeline stage is logged to the `PipelineLog` audit table with timing, input/output summaries, and source metadata.

### Three-Layer Data Model

| Layer | DB Model | Fields | Behavior |
|---|---|---|---|
| **Immutable** | `CustomerIdentity` | firstName, lastName, dateOfBirth, nationality, gender, taxId | Set once, never overwritten. Conflicts are logged to `Customer.identityConflicts` with full lineage (source message, source type, confidence values, timestamp). |
| **Mutable** | `CustomerAttribute` | emails, phones, addresses, maritalStatus, occupation, employer | `isCurrent` flag managed by `recalculateCurrent()`. Latest `messageDate` wins for scalars. List fields (email, phone, address) accumulate all distinct values. Full history preserved for audit. |
| **Inferred** | `CustomerInsight` | communicationPreferences, hobbies, needs, riskIndicators, familyContext, notes | Accumulated across messages. Deduplicated by normalized value. Never overwritten or deleted. |

The `Customer` model has denormalized identity fields (firstName, lastName, etc.) for quick lookups. The `Message` model tracks processing status (PENDING → PROCESSING → COMPLETED/FAILED).

### Source Tracking and Data Lineage

Every data point in the system links back to its source:

- **`sourceMessageId`** on every `CustomerIdentity`, `CustomerAttribute`, and `CustomerInsight` record — traces each field value to the exact message that contributed it
- **`messageDate`** stored alongside every value — enables temporal conflict resolution regardless of ingestion order
- **`confidence`** scores (0.0–1.0) on every field — LLM-assigned confidence, enhanced when customer context confirms a match
- **`PipelineLog`** table — records every pipeline stage execution per message with timing, input/output summaries, and decision reasoning
- **`identityConflicts`** on `Customer` — when immutable fields conflict, the record captures both values, both source messages, source types, confidence values, and detection timestamp
- **Pipeline audit trail** — the `PipelineLog` captures full search candidate rankings (top 5 with scores, signals, and taxId match status) for every SEARCH stage, enabling post-hoc analysis of matching decisions

---

## Design Decisions

### Format-Agnostic Extraction
The pipeline has zero format-specific parsing code. The LLM system prompt handles all formats (emails, chat, documents, forms) through a single extraction flow. The user prompt dynamically includes available metadata (subject, from, to, channel, documentType) without format branching.

### Context-Enhanced Re-Extraction
When the Search stage finds a high-confidence match, the pipeline performs a second LLM call with the matched customer's profile injected as context. This dramatically improves extraction quality:
- Name ambiguities resolved ("Maria" → "María García López")
- Partial data completed (city name matched to known address)
- Confidence calibrated (data matching known profile → 1.0, contradictions → 0.5–0.7)
- The re-extraction result is merged with the original, preferring higher-confidence values

### Idempotent Processing
- PostgreSQL advisory locks (`pg_advisory_xact_lock`) inside `$transaction` prevent duplicate processing of the same message under concurrent requests
- Fast-path `ALREADY_PROCESSED` check before acquiring the lock avoids unnecessary contention
- Stale `PROCESSING` messages (>5 min) are automatically reclaimed for retry

### Non-Chronological Arrival
Messages can arrive in any order. `recalculateCurrent()` re-evaluates `isCurrent` flags after each insert by comparing `messageDate` across all entries for a field. The value from the latest `messageDate` always wins, regardless of ingestion order.

### List Field Accumulation
Contact fields (email, phone, address) accumulate all distinct values — in an insurance context, a customer's second email doesn't invalidate the first. All known contact points are preserved. All entries from the latest `messageDate` are marked as current.

### LLM Retry with Model Fallback
3 attempts on primary model (`gpt-oss-120b`) with exponential backoff, then 1 attempt on fallback model (`Kimi-K2.5`). This ensures resilience against transient API failures.

### Transaction-Safe Persistence
Prisma 7's `@prisma/adapter-pg` does not use savepoints inside interactive transactions. All uniqueness checks use `findFirst` before `create` (never try/catch for constraint violations), and insight values are deduplicated in-memory before insertion. This prevents PostgreSQL transaction abort from P2002 violations.

### Decision Transparency
Every decision is annotated with:
- `decisionCode` — machine-parsable reason (e.g., `TAXID_MATCH`, `HIGH_CONFIDENCE`, `NO_CANDIDATES`)
- `reasoning` — human-readable explanation with threshold values and signal details
- `matchScore` and `matchSignals` — returned in the API response for immediate visibility

---

## Data Model Design

### Separation of Deterministic, Mutable, and Non-Deterministic Data

The data model enforces strict separation via three distinct Prisma models, each with different write semantics:

**Layer 1 — `CustomerIdentity` (Immutable/Deterministic)**

Stores factual fields that do not change: `firstName`, `lastName`, `dateOfBirth`, `nationality`, `gender`, `taxId`. Enforced by a `@@unique([customerId, field])` constraint — only one value per field per customer. Conflicts are never overwritten; instead they are logged to `Customer.identityConflicts` with full lineage (both source messages, source types, confidence values, detection timestamp).

```
@@unique([customerId, field])   — one value per identity field, enforced at DB level
```

**Layer 2 — `CustomerAttribute` (Mutable/Deterministic)**

Stores fields that change over time: `email`, `phone`, `address`, `maritalStatus`, `occupation`, `employer`. Every value ever seen is preserved as a separate row. An `isCurrent` boolean flag marks which value(s) are active. For scalar fields (maritalStatus, occupation, employer), exactly one value is current. For list fields (email, phone, address), all distinct values from the latest `messageDate` are current simultaneously.

```
@@unique([customerId, field, sourceMessageId, messageDate, value])   — prevents duplicate entries
@@index([customerId, field, isCurrent])                              — fast current-value lookups
@@index([customerId, field, messageDate])                            — fast temporal queries
```

**Layer 3 — `CustomerInsight` (Non-Deterministic/Inferred)**

Stores LLM-inferred data: `communicationPreferences`, `hobbies`, `needs`, `riskIndicators`, `familyContext`, `notes`. These accumulate across messages and are never replaced or deleted. Default confidence is `0.7` (lower than deterministic fields) reflecting their inferred nature.

```
@@unique([customerId, field, value, sourceMessageId])   — prevents duplicate inferences from same source
@@index([customerId, field])                             — fast field lookups
```

Field categorization is centralized in `src/types/fields.ts`:

```typescript
export const IDENTITY_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'nationality', 'gender', 'taxId'] as const;
export const MUTABLE_SCALAR_FIELDS = ['maritalStatus', 'occupation', 'employer'] as const;
export const INFERRED_FIELDS = ['communicationPreferences', 'hobbies', 'needs', 'riskIndicators', 'familyContext', 'notes'] as const;
```

### History Preservation and Temporal Resolution

**Every value is preserved** — no UPDATE or DELETE on data rows during normal operations. The system only inserts new rows and flips `isCurrent` flags.

- **`CustomerIdentity`**: First value wins. Subsequent conflicting values are recorded in `Customer.identityConflicts` JSON array with both the kept and rejected values, both source message IDs, source types, confidence scores, and detection timestamp.
- **`CustomerAttribute`**: All historical values remain in the database with `isCurrent = false`. After each insert, `recalculateCurrent()` re-evaluates all entries for that `(customerId, field)` pair: the entry/entries with the latest `messageDate` become current, all others become historical.
- **`CustomerInsight`**: Purely additive — new insights are appended, never removed or replaced.

**Temporal resolution for non-chronological arrival:**

Messages can arrive in any order. The system resolves this correctly because `recalculateCurrent()` compares `messageDate` across all entries (not insertion order). Example: if message A (dated June) arrives first and sets `occupation = "Developer"`, then message B (dated January) arrives later with `occupation = "Intern"`, the June value remains current because its `messageDate` is newer.

```typescript
// recalculateCurrent() in persist.ts — latest messageDate wins
const allEntries = await tx.customerAttribute.findMany({
  where: { customerId, field },
  orderBy: [{ messageDate: 'desc' }, { createdAt: 'desc' }],
});
const latestDate = allEntries[0].messageDate.getTime();
const currentIds = allEntries
  .filter(e => e.messageDate.getTime() === latestDate)
  .map(e => e.id);
// Mark only latest as current, all others as historical
```

**Source attribution on every row:**

Every `CustomerIdentity`, `CustomerAttribute`, and `CustomerInsight` row stores:
- `sourceMessageId` — which message contributed this data point
- `messageDate` — the temporal anchor for conflict resolution
- `confidence` — LLM-assigned extraction confidence (0.0–1.0)
- `createdAt` — when the row was physically written

### Schema Design and Extensibility

**Adding a new identity field** (e.g., `placeOfBirth`):
1. Add to `IDENTITY_FIELDS` array in `src/types/fields.ts`
2. Add the column to `Customer` model in `prisma/schema.prisma` (denormalized)
3. Add to the `ExtractedPerson` type — no changes needed in `persist.ts` (it loops over `IDENTITY_FIELDS`)

**Adding a new mutable field** (e.g., `income`):
1. Add to `MUTABLE_SCALAR_FIELDS` in `src/types/fields.ts`
2. Add to `ExtractedPerson` type — `persist.ts` already loops over `MUTABLE_SCALAR_FIELDS`

**Adding a new insight field** (e.g., `lifeEvents`):
1. Add to `INFERRED_FIELDS` in `src/types/fields.ts`
2. Add to `ExtractedPerson` type — `persist.ts` already loops over `INFERRED_FIELDS`

No persistence code changes needed in any case — the field arrays drive all logic.

**EAV-style flexibility:** The `CustomerAttribute` and `CustomerInsight` models use an Entity-Attribute-Value pattern (`field` + `value` columns) rather than fixed columns. This means new field types don't require database migrations — they're just new string values in the `field` column.

**Structured data support:** `CustomerAttribute` has an optional `valueJson` column (`Json?`) alongside the text `value`. This allows complex fields like addresses to be stored as structured JSON for rich querying while maintaining a canonical text representation for uniqueness constraints.

**Database schema (6 models):**

```
Customer              — Denormalized identity fields + conflict log
├── CustomerIdentity  — Layer 1: one row per immutable field (EAV)
├── CustomerAttribute — Layer 2: full history of mutable values (EAV + isCurrent flag)
├── CustomerInsight   — Layer 3: accumulated inferred data (EAV)
├── Message           — Ingested messages with processing status + decision metadata
└── PipelineLog       — Per-stage audit trail with timing and I/O summaries
```

---

## Setup Instructions

### Prerequisites

- Docker and Docker Compose
- Nebius AI Platform API key

### Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd technical-test-context-engineering

# 2. Copy the environment file and set your API key
cp .env.example .env
# Edit .env and replace "your-api-key-here" with your actual Nebius API key

# 3. Start everything (app + PostgreSQL)
docker compose up --build

# 4. Ingest the 15 sample messages (pick one method)
make ingest                              # via terminal
# OR open http://localhost:3000/dashboard, expand "Ingest Message", click "Dataset" tab → "Load Dataset"
```

The service starts on `http://localhost:3000`. The dashboard is at `http://localhost:3000/dashboard`. Health check: `GET /health`.

### Environment Variables

All environment variables are configured via the `.env` file (copied from `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEBIUS_API_KEY` | Yes | — | Nebius AI Platform API key |
| `DATABASE_URL` | No | `postgresql://postgres:postgres@localhost:5432/digital_twin?schema=public` | PostgreSQL connection string (overridden by Docker Compose for the app container) |
| `PORT` | No | `3000` | HTTP server port |
| `HOST` | No | `0.0.0.0` | HTTP bind address |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | No | `development` | Node environment (`development`, `production`) |

### Local Development (without Docker)

```bash
# Install dependencies
make install              # npm ci

# Start PostgreSQL only
make db-up                # docker compose up -d db

# Apply database migrations
make db-migrate           # npx prisma migrate dev

# Start dev server with hot reload
make dev                  # npx tsx watch src/index.ts

# Run tests
make test                 # npx vitest run

# Full verification (typecheck + tests + build)
make verify
```

### Makefile Commands

| Command | Description |
|---|---|
| `make install` | Install all dependencies |
| `make dev` | Start dev server with hot reload |
| `make build` | Compile TypeScript to `dist/` |
| `make test` | Run all tests (110 tests) |
| `make test-unit` | Unit tests only |
| `make test-integration` | Integration tests (requires PostgreSQL) |
| `make test-e2e` | End-to-end dataset test |
| `make lint` | ESLint + TypeScript typecheck |
| `make verify` | Typecheck + tests + build |
| `make ingest` | Ingest all 15 dataset messages |
| `make docker-up` | Start app + db with Docker |
| `make docker-down` | Stop all Docker services |
| `make db-studio` | Open Prisma Studio GUI |

---

## API Documentation

### POST /api/messages

Ingest a single unstructured message for processing.

**Request:**

```json
{
  "id": "email-001",
  "source": "email",
  "messageDate": "2025-03-10T09:15:00Z",
  "subject": "Policy Inquiry",
  "from": "maria.garcia@email.com",
  "to": "agent@insurance.com",
  "body": "Dear Agent, my name is María García López. I was born on 14 March 1985. My Tax ID is 12345678A. I am interested in life insurance options..."
}
```

**Response (200):**

```json
{
  "status": "ok",
  "messageId": "email-001",
  "customerId": "cm5abc123def",
  "action": "CREATE",
  "matchScore": 0,
  "matchSignals": []
}
```

**Action values:**

| Action | Description |
|---|---|
| `CREATE` | New customer profile created |
| `UPDATE` | Matched and updated existing customer |
| `SKIP` | No identifiable person extracted from message |
| `ALREADY_PROCESSED` | Message was previously processed (idempotent replay) |
| `ALREADY_PROCESSING` | Another request is currently processing this message |

**Error Response (400):**

```json
{
  "statusCode": 400,
  "code": "FST_ERR_VALIDATION",
  "error": "Bad Request",
  "message": "body/messageDate must match format \"date-time\""
}
```

### POST /api/messages/batch

Ingest multiple messages in one request. Each message is processed sequentially through the full pipeline.

**Request:**

```json
{
  "messages": [
    { "id": "email-001", "source": "email", "messageDate": "2025-03-10T09:15:00Z", "body": "..." },
    { "id": "msg-001", "source": "message", "messageDate": "2025-04-20T10:45:00Z", "body": "..." }
  ]
}
```

**Response (200):**

```json
{
  "results": [
    {
      "status": "ok",
      "messageId": "email-001",
      "customerId": "cm5abc123def",
      "action": "CREATE",
      "matchScore": 0,
      "matchSignals": []
    },
    {
      "status": "ok",
      "messageId": "msg-001",
      "customerId": "cm5abc123def",
      "action": "UPDATE",
      "matchScore": 1.0,
      "matchSignals": ["taxId"]
    }
  ]
}
```

### GET /api/customers

List all customer profiles with current attribute values and accumulated insights.

**Response (200):**

```json
{
  "customers": [
    {
      "id": "cm5abc123def",
      "firstName": "María",
      "lastName": "García López",
      "dateOfBirth": "1985-03-14",
      "nationality": "Spanish",
      "gender": "Female",
      "taxId": "12345678A",
      "currentAttributes": {
        "maritalStatus": "Married",
        "occupation": "Senior Software Engineer",
        "employer": "TechCorp GmbH",
        "email": ["m.garcia85@gmail.com", "maria.garcia@email.com"],
        "phone": ["+34 612 345 678", "+49 171 2345678"],
        "address": ["{\"street\":\"Leopoldstraße 15\",\"city\":\"Munich\",...}"]
      },
      "insights": {
        "hobbies": ["hiking", "cooking"],
        "needs": ["life insurance", "retirement savings"],
        "riskIndicators": ["non-smoker"],
        "communicationPreferences": ["prefers email"],
        "familyContext": ["has stepchildren"]
      },
      "messageCount": 8
    }
  ]
}
```

### GET /api/customers/:id

Full customer detail including identity fields, complete attribute history, all insights, identity conflicts with lineage, and linked messages.

**Response (200):**

```json
{
  "customer": {
    "id": "cm5abc123def",
    "firstName": "María",
    "lastName": "García López",
    "dateOfBirth": "1985-03-14",
    "nationality": "Spanish",
    "gender": "Female",
    "taxId": "12345678A",
    "identityConflicts": [
      {
        "field": "lastName",
        "keptValue": "García López",
        "rejectedValue": "Garcia",
        "existingSourceMessageId": "email-001",
        "newSourceMessageId": "msg-002",
        "newSourceType": "message",
        "existingConfidence": "1",
        "newConfidence": "0.8",
        "detectedAt": "2026-02-16T17:07:25.861Z"
      }
    ],
    "identities": [
      {
        "field": "firstName",
        "value": "María",
        "confidence": 1,
        "sourceMessageId": "email-001",
        "messageDate": "2025-03-10T09:15:00.000Z"
      }
    ],
    "attributes": [
      {
        "field": "email",
        "value": "maria.garcia@email.com",
        "isCurrent": true,
        "confidence": 1,
        "sourceMessageId": "email-003",
        "messageDate": "2025-06-01T09:00:00.000Z"
      }
    ],
    "insights": [
      {
        "field": "hobbies",
        "value": "hiking",
        "confidence": 0.7,
        "sourceMessageId": "email-001",
        "messageDate": "2025-03-10T09:15:00.000Z"
      }
    ],
    "messages": [
      {
        "id": "email-001",
        "source": "email",
        "messageDate": "2025-03-10T09:15:00.000Z",
        "status": "COMPLETED"
      }
    ]
  }
}
```

**Error Response (404):**

```json
{ "status": "error", "message": "Customer not found" }
```

### GET /api/customers/duplicates

Detect potential duplicate customer profiles using fuzzy matching.

**Response (200):**

```json
{
  "duplicates": [],
  "totalCustomers": 2,
  "capped": false
}
```

### POST /api/customers/merge

Merge two customer profiles. The target customer absorbs all data from the source customer.

**Request:**

```json
{
  "sourceCustomerId": "cm5source123",
  "targetCustomerId": "cm5target456"
}
```

**Response (200):**

```json
{
  "status": "ok",
  "merge": {
    "targetCustomerId": "cm5target456",
    "sourceCustomerId": "cm5source123",
    "identitiesMoved": 2,
    "attributesMoved": 5,
    "insightsMoved": 3,
    "messagesMoved": 4,
    "identityConflicts": []
  }
}
```

### GET /api/messages/:id/pipeline

Pipeline audit log for a specific message. Returns every stage the message passed through with timing, input/output summaries, and the final decision.

**Response (200):**

```json
{
  "messageId": "email-001",
  "status": "COMPLETED",
  "customerId": "cm5abc123def",
  "decisionCode": "NO_CANDIDATES",
  "decisionReasoning": "No existing customers matched. Creating new customer profile.",
  "pipeline": [
    {
      "stage": "EXTRACT",
      "sequence": 0,
      "timestamp": "2026-02-16T17:05:15.078Z",
      "durationMs": 12925,
      "summary": "Extracted 1 person(s)",
      "input": null,
      "output": {
        "personCount": 1,
        "fieldsExtracted": ["firstName", "lastName", "occupation", "emails", "phones", "needs"],
        "avgConfidence": 0.97
      }
    },
    {
      "stage": "SEARCH",
      "sequence": 1,
      "timestamp": "2026-02-16T17:05:15.088Z",
      "durationMs": 10,
      "summary": "Found 0 candidate(s), best score 0.00",
      "input": null,
      "output": {
        "candidateCount": 0,
        "bestScore": 0,
        "bestSignals": [],
        "directLookupHits": 0,
        "topCandidates": []
      }
    },
    {
      "stage": "RE_EXTRACT",
      "sequence": 2,
      "timestamp": "2026-02-16T17:05:15.088Z",
      "durationMs": null,
      "summary": "Re-extraction not triggered (match confidence too low)",
      "input": null,
      "output": {
        "triggered": false,
        "fieldsChanged": [],
        "fieldsAdded": [],
        "mergeStrategy": "none"
      }
    },
    {
      "stage": "DECIDE",
      "sequence": 3,
      "timestamp": "2026-02-16T17:05:15.088Z",
      "durationMs": 0,
      "summary": "CREATE — No existing customers matched.",
      "input": null,
      "output": {
        "action": "CREATE",
        "decisionCode": "NO_CANDIDATES",
        "score": 0,
        "signals": []
      }
    },
    {
      "stage": "PERSIST",
      "sequence": 4,
      "timestamp": "2026-02-16T17:05:15.127Z",
      "durationMs": 39,
      "summary": "Persisted to customer cm5abc123def",
      "input": null,
      "output": {
        "customerId": "cm5abc123def",
        "identitiesWritten": 2,
        "attributesWritten": 4,
        "insightsWritten": 3
      }
    }
  ]
}
```

**Error Response (404):**

```json
{ "status": "error", "message": "Message not found" }
```

### GET /api/metrics

Pipeline performance metrics including timing percentiles, counters, and error rate.

**Response (200):**

```json
{
  "pipeline": {
    "messagesReceived": 15,
    "messagesProcessed": 15,
    "messagesFailed": 0,
    "messagesSkipped": 0,
    "customersCreated": 2,
    "customersUpdated": 13,
    "customersMerged": 0
  },
  "timings": {
    "extract": { "avg": 11545, "min": 7182, "max": 18294, "count": 15, "p95": 18294 },
    "search": { "avg": 4, "min": 2, "max": 14, "count": 15, "p95": 14 },
    "decide": { "avg": 0, "min": 0, "max": 1, "count": 15, "p95": 1 },
    "persist": { "avg": 42, "min": 27, "max": 67, "count": 15, "p95": 67 },
    "total": { "avg": 22950, "min": 9205, "max": 35338, "count": 15, "p95": 35338 }
  },
  "errorRate": 0,
  "database": { "customers": 2, "messages": 15 }
}
```

### GET /health

Health check endpoint.

**Response (200):**

```json
{ "status": "ok" }
```

### GET /dashboard

Web UI for browsing customer profiles, viewing attribute history, and inspecting pipeline logs. The dashboard also includes a built-in **Ingest Message** panel (in the sidebar) with three ways to ingest data without using the terminal:

- **Form** — Fill in fields (ID, source, date, subject, from, to, body) and submit a single message
- **JSON** — Paste raw JSON (single message or array) and ingest directly
- **Dataset** — One-click button to load and ingest all 15 dataset messages with a progress bar

After ingestion, the customer list and metrics refresh automatically.

### GET /dataset

Returns all dataset messages from the `dataset/` directory (used by the dashboard's Dataset ingestion tab).

**Response (200):**

```json
{
  "messages": [
    { "id": "doc-001", "source": "document", "messageDate": "2025-01-15T00:00:00Z", "body": "..." },
    { "id": "email-001", "source": "email", "messageDate": "2025-03-10T09:15:00Z", "body": "..." }
  ],
  "count": 15
}
```

### GET /

Redirects to `/dashboard`.

---

## Processed Results

After ingesting all 15 dataset messages (5 emails, 5 messages, 5 documents), the system correctly reconstructs two customer profiles:

### Customer A: Maria García López

| Field | Value |
|---|---|
| **Name** | Maria García López |
| **Date of Birth** | 1985-03-14 |
| **Nationality** | Spanish |
| **Gender** | Female |
| **Tax ID** | 12345678A |
| **Marital Status** | Married (current, from Sep 2025; previously Single in Jan 2025) |
| **Occupation** | Senior Software Engineer |
| **Employer** | TechCorp GmbH |
| **Current Email** | maria.garcia@email.com (historical: m.garcia85@gmail.com) |
| **Current Phone** | +34 612 345 678 (historical: +49 171 2345678) |
| **Current Address** | Leopoldstraße 15, Apt 4B, 80802 München, Germany (historical: Calle Gran Vía 28, Madrid, Spain) |
| **Hobbies** | Hiking, cooking |
| **Needs** | Life insurance, term life insurance, coverage for stepchildren, retirement savings, children's education coverage |
| **Risk Indicators** | Non-smoker, healthy lifestyle, active lifestyle (hiking), no pre-existing conditions, regular exercise |
| **Communication** | Prefers email |
| **Family** | Married partner (spouse), stepchildren ages 8 and 11 |
| **Messages Processed** | 7 (email-001, email-003, email-005, msg-002, msg-004, doc-001, doc-003) |

**Profile evolution:** Started in Madrid as a Software Developer at MadridSoft S.L. with email m.garcia85@gmail.com (doc-001, Jan 2025). Updated to Senior Software Engineer at TechCorp GmbH (msg-004, Apr 2025). Switched email to maria.garcia@email.com (msg-002, May 2025). Relocated to Munich, added German phone +49 171 2345678, address changed to Leopoldstraße (doc-003, Jul 2025). Latest message (email-005, Sep 2025) confirms Munich address, original Spanish phone as current, and married status. The system correctly tracks all transitions with full history preserved.

<details>
<summary>Full API response (GET /api/customers — Maria García López)</summary>

```json
{
  "id": "cmlpfdg0j000001mjw59umz0g",
  "firstName": "Maria",
  "lastName": "García López",
  "dateOfBirth": "1985-03-14",
  "nationality": "Spanish",
  "gender": "Female",
  "taxId": "12345678A",
  "currentAttributes": {
    "maritalStatus": "Married",
    "occupation": "Senior Software Engineer",
    "employer": "TechCorp GmbH",
    "email": ["maria.garcia@email.com"],
    "phone": ["+34 612 345 678"],
    "address": [
      "{\"city\":\"München\",\"street\":\"Leopoldstraße 15, Apt 4B\",\"country\":\"Germany\",\"postalCode\":\"80802\",\"fullAddress\":\"Leopoldstraße 15, Apt 4B, 80802 München, Germany\"}"
    ]
  },
  "insights": {
    "needs": [
      "life insurance",
      "term life insurance",
      "coverage for future family",
      "term life insurance (option b, 500,000€ coverage)",
      "life insurance coverage for stepchildren",
      "family-oriented retirement savings plans",
      "children's education coverage",
      "update life insurance policy to include stepchildren as beneficiaries",
      "increase life insurance coverage amount",
      "information about family-oriented retirement savings plans",
      "coverage for children's education",
      "health assessment"
    ],
    "notes": [
      "recently moved to germany but currently residing at address in madrid, spain",
      "completed relocation to germany",
      "new address: leopoldstraße 15, apt 4b, 80802 münchen",
      "started new position as senior software engineer at techcorp gmbh",
      "interested in term life insurance policy option b with 500,000€ coverage",
      "wants to schedule a call next week to finalize details",
      "customer prefers handling matters via email due to a hectic schedule.",
      "married in august 2025",
      "works in an open office and cannot take personal calls during the day",
      "question about application; submitted documents last month and hasn't heard back.",
      "customer confirmed current address in madrid.",
      "sent an email last month about life insurance and requested confirmation of application.",
      "application signed on 2025-01-15",
      "application date: 2025-01-15",
      "annual income: €45,000",
      "address change effective from 1 june 2025",
      "employment start date 1 june 2025",
      "address change notification dated 01 july 2025. updated phone number and confirmed email. employment unchanged. marital status confirmed as married as of 15 june 2025."
    ],
    "hobbies": ["hiking", "cooking"],
    "riskIndicators": [
      "active lifestyle (hiking in the alps)",
      "non-smoker",
      "does not drink alcohol",
      "healthy lifestyle",
      "no pre-existing conditions",
      "regular exercise"
    ],
    "communicationPreferences": ["prefers email"],
    "familyContext": [
      "married partner (spouse)",
      "stepchildren ages 8 and 11",
      "partner (spouse)",
      "stepchildren (ages 8 and 11)",
      "married"
    ]
  },
  "messageCount": 7
}
```

</details>

### Customer B: Thomas Weber

| Field | Value |
|---|---|
| **Name** | Thomas Weber |
| **Date of Birth** | 1978-07-22 |
| **Nationality** | German |
| **Gender** | Male |
| **Tax ID** | 65 432 187 909 |
| **Marital Status** | Divorced |
| **Occupation** | Senior Accountant |
| **Employer** | FinanzBeratung AG |
| **Current Email** | t.weber@business.de |
| **Current Phone** | +49 151 7654321 (historical: +49 30 9876543) |
| **Current Address** | Prenzlauer Allee 88, 10409 Berlin, Germany (historical: Friedrichstraße 42, 10117 Berlin) |
| **Hobbies** | Cycling, photography, motorcycling, motorcycle riding |
| **Needs** | Private health insurance, investment-linked insurance, retirement planning, Riester-Rente, motorcycle insurance, single parent insurance |
| **Risk Indicators** | Back issues, back problems, motorcycle riding, motorcycle ownership (BMW R1250GS), physiotherapy needs |
| **Communication** | Prefers phone calls |
| **Family** | Son Lukas (age 12), 50% custody, lives with him every other week |
| **Messages Processed** | 8 (email-002, email-004, msg-001, msg-003, msg-005, doc-002, doc-004, doc-005) |

**Profile evolution:** Started as a Freelance Accountant at Friedrichstraße 42, Berlin (msg-001, Feb 2025). Registration form confirmed details (doc-002, Mar 2025). Joined FinanzBeratung AG as Senior Accountant (msg-003, Jun 2025). Added mobile phone +49 151 7654321 (msg-003). Moved to Prenzlauer Allee 88, Berlin (doc-005, Sep 2025). Purchased BMW R1250GS motorcycle (doc-005, Sep 2025). The system correctly tracks his career, address, and phone transitions with full history.

<details>
<summary>Full API response (GET /api/customers — Thomas Weber)</summary>

```json
{
  "id": "cmlpfdtot000h01mjnhpytjsf",
  "firstName": "Thomas",
  "lastName": "Weber",
  "dateOfBirth": "1978-07-22",
  "nationality": "German",
  "gender": "Male",
  "taxId": "65 432 187 909",
  "currentAttributes": {
    "maritalStatus": "Divorced",
    "occupation": "Senior Accountant",
    "employer": "FinanzBeratung AG",
    "email": ["t.weber@business.de"],
    "phone": ["+49 151 7654321"],
    "address": [
      "{\"city\":\"Berlin\",\"street\":\"Prenzlauer Allee 88\",\"country\":\"Germany\",\"postalCode\":\"10409\",\"fullAddress\":\"Prenzlauer Allee 88, 10409 Berlin, Germany\"}"
    ]
  },
  "insights": {
    "communicationPreferences": ["prefers phone calls"],
    "needs": [
      "private health insurance covering physiotherapy and specialist visits",
      "investment-linked insurance",
      "retirement planning",
      "riester-rente",
      "investment-linked insurance products",
      "private health insurance",
      "general insurance coverage",
      "proper insurance coverage",
      "single parent insurance",
      "child coverage for 12-year-old son",
      "insurance for single parent",
      "coverage for son lukas",
      "health insurance coverage for motorcycle accidents",
      "expedited health insurance processing",
      "health insurance coverage for back problems and physiotherapy",
      "family health insurance coverage for son",
      "investment-linked retirement products (riester-rente, rürup-rente)",
      "motorcycle insurance",
      "health insurance risk assessment"
    ],
    "riskIndicators": [
      "back issues",
      "no private health insurance",
      "age-related health risk",
      "back problems",
      "motorcycle riding",
      "motorcycle riding (risk of accidents)",
      "physiotherapy needs",
      "motorcycle ownership (bmw r1250gs)"
    ],
    "notes": [
      "current public insurance does not cover everything needed",
      "recently changed positions to senior accountant at finanzberatung ag.",
      "interested in investment-linked insurance products suitable for retirement planning and tax‑advantaged options such as riester‑rente.",
      "customer requests a callback to discuss insurance options.",
      "considering turning photography into a side business",
      "divorced about two years ago",
      "customer has been waiting for months for health insurance processing",
      "waiting for months for health insurance",
      "concern about worsening back condition",
      "signed: thomas weber",
      "monthly net income: €4,200",
      "considering career change to join an established firm for more stability",
      "customer purchased a motorcycle (bmw r1250gs) in august 2025. expressed interest in adding motorcycle insurance to his portfolio.",
      "customer purchased a motorcycle (bmw r1250gs) in august 2025. please assess if this affects his risk profile for the health insurance policy. customer also expressed interest in adding motorcycle insurance to his portfolio."
    ],
    "hobbies": ["cycling", "photography", "motorcycling", "motorcycle riding"],
    "familyContext": [
      "12-year-old son lukas, lives with him every other week",
      "son lukas, 12 years old, lives with me every other week",
      "son, age 11",
      "son lukas, age 12, 50% custody"
    ]
  },
  "messageCount": 8
}
```

</details>

### Ingestion Summary

```
15 messages processed: 15 succeeded, 0 failed
2 customers created (email-001 → Maria García López, email-002 → Thomas Weber)
13 updates matched to existing customers
Error rate: 0%
```

All messages are correctly attributed to the right customer via taxId matching, fuzzy name/email/phone matching, and composite scoring. The system handles non-chronological arrival, preserves complete history, and resolves conflicts based on `messageDate`.

---

## Testing

```bash
make test              # all 110 tests
make test-unit         # unit tests only (matching, normalization, metrics, extraction)
make test-integration  # integration tests (full pipeline, API, idempotency, merge, resilience)
make test-e2e          # end-to-end dataset test (ingests all 15 messages, verifies profiles)
make test-coverage     # with coverage report
```

**Test suite breakdown (110 tests):**

- **Unit tests** — Jaro-Winkler fuzzy matching, composite scorer, normalizer, PII redaction, metrics, extraction parser
- **Integration tests** — Full pipeline with mocked LLM, API endpoint coverage, idempotency guarantees, customer merge, error resilience, dashboard, pipeline audit logging
- **E2E test** — Ingests all 15 dataset messages via the API and verifies both customer profiles are correctly reconstructed

Tests use deterministic mocked LLM responses (`tests/helpers/llm-mock.ts`) — no real API calls. Integration and E2E tests require a running PostgreSQL (via `make db-up`).

---

## Tech Stack

| Component | Technology |
|---|---|
| **Runtime** | TypeScript (ESM) + Node.js 24 |
| **HTTP** | Fastify 5 with `@fastify/cors`, ajv-formats |
| **Database** | PostgreSQL 18 via Prisma 7 ORM with `@prisma/adapter-pg` |
| **LLM** | OpenAI SDK v6 → Nebius AI Platform (GPT-OSS-120B + Kimi-K2.5 fallback) |
| **Validation** | Zod 4 (LLM output) + JSON Schema (API input) |
| **Testing** | Vitest 4 (110 tests) |
| **Logging** | Pino 10 with PII redaction |
| **Infrastructure** | Docker + Docker Compose |

---

## Project Structure

```
src/
  pipeline/             # 5-stage pipeline orchestrator
    index.ts            #   Pipeline coordinator with advisory locks
    extract.ts          #   LLM extraction stage
    search.ts           #   Fuzzy matching + candidate scoring
    context-builder.ts  #   Builds customer context for re-extraction
    merge-extractions.ts#   Merges original + context-enhanced extractions
    decide.ts           #   CREATE/UPDATE/SKIP decision logic
    persist.ts          #   Three-layer data persistence
    pipeline-logger.ts  #   Audit log writer (PipelineLog table)
  llm/                  # LLM integration
    client.ts           #   OpenAI SDK client setup
    prompts.ts          #   System + user prompt construction
    context-prompts.ts  #   Context-enhanced re-extraction prompt
    parser.ts           #   JSON response parser with fallbacks
    retry.ts            #   Retry logic with model fallback
  matching/             # Customer matching
    fuzzy.ts            #   Jaro-Winkler similarity
    scorer.ts           #   Composite weighted scoring
  routes/               # Fastify route handlers
    messages.ts         #   POST /api/messages, POST /api/messages/batch
    customers.ts        #   GET /api/customers, GET /api/customers/:id, duplicates, merge
    health.ts           #   GET /health
  services/             # Business logic
    customer.service.ts #   Customer profile assembly
    duplicates.service.ts#  Duplicate detection
    merge.service.ts    #   Customer merge with conflict resolution
  schemas/              # Validation schemas
    extraction.schema.ts#   Zod schema for LLM output
    pipeline.schema.ts  #   Pipeline stage type definitions
  types/                # TypeScript interfaces
    extraction.ts       #   ExtractedPerson, FieldConfidence
    pipeline.ts         #   PipelineContext, PipelineDecision
    message.ts          #   InboundMessage
    fields.ts           #   IDENTITY_FIELDS, MUTABLE_SCALAR_FIELDS, INFERRED_FIELDS
  observability/        # Metrics + monitoring
    metrics.ts          #   Pipeline performance counters + timing
  utils/                # Shared utilities
    normalize.ts        #   Value canonicalization
    hash.ts             #   Deterministic hashing for advisory locks
    pii-redact.ts       #   PII redaction for logs
    extraction-helpers.ts#  Shared extraction utilities
  logger.ts             # Pino logger with PII redaction
  config.ts             # Configuration (models, thresholds)
  db.ts                 # Prisma client initialization
  app.ts                # Fastify app setup
  index.ts              # Server entry point
prisma/
  schema.prisma         # Database schema (6 models)
  migrations/           # Migration history
dataset/                # 15 sample messages (5 emails, 5 messages, 5 documents)
tests/
  unit/                 # Unit tests (matching, utils, metrics, extraction)
  integration/          # Integration tests (pipeline, API, merge, resilience)
  e2e/                  # End-to-end dataset test
  helpers/              # Test utilities (setup, DB cleanup, LLM mock)
```
