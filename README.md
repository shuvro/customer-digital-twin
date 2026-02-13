# Technical Test — Context Engineering: Customer Digital Twin

## Overview

Your mission is to build a **Customer Digital Twin** service — an intelligent pipeline that ingests unstructured data from multiple sources (emails, chat messages, and documents), extracts customer information, and maintains a living, up-to-date customer profile.

This test evaluates your ability to design and implement a **context engineering** solution: building the right data model, orchestrating an AI-powered extraction pipeline, and handling the inherent ambiguity of real-world unstructured data.

---

## The Problem

An insurance company receives customer data through various unstructured channels:

- **Emails** — correspondence between agents and customers
- **Messages** — chat or SMS conversations
- **Documents** — scanned forms, policy documents, claim reports

Each message may contain fragments of customer information scattered across free-form text. Your system must:

1. **Extract** structured customer data from each unstructured entry
2. **Identify** which customer the data belongs to (search/match)
3. **Decide** whether to **create** a new customer profile or **update** an existing one
4. **Maintain** a rich, layered customer profile as a digital twin

---

## Customer Profile Data Model

The customer profile must be organized into three categories of data:

### 1. Deterministic (Immutable) Data
Data that is factual and does not change over a customer's lifetime:

| Field | Example |
|---|---|
| `firstName` | Maria |
| `lastName` | García López |
| `dateOfBirth` | 1985-03-14 |
| `nationality` | Spanish |
| `gender` | Female |
| `taxId` | 12345678A |

### 2. Deterministic (Mutable) Data
Data that is factual but can change over time. The system must keep history and always surface the most recent value:

| Field | Example |
|---|---|
| `addresses` | List of addresses with timestamps |
| `emails` | List of email addresses with timestamps |
| `phones` | List of phone numbers with timestamps |
| `maritalStatus` | Married (as of 2024-06-15) |
| `occupation` | Software Engineer (as of 2025-01-10) |
| `employer` | TechCorp GmbH (as of 2025-01-10) |

### 3. Non-Deterministic (Inferred) Data
Data that is inferred from context, may be subjective, and accumulates over time:

| Field | Example |
|---|---|
| `communicationPreferences` | Prefers email over phone |
| `hobbies` | Hiking, reading, cooking |
| `needs` | Looking for life insurance, interested in retirement planning |
| `riskIndicators` | Smoker, drives motorcycle |
| `familyContext` | Has two children, lives with spouse |
| `notes` | Mentioned recent job change, expressed urgency about health coverage |

---

## Requirements

### 1. Message Ingestion API

Build a REST API with **at minimum** these two endpoints:

#### `POST /api/messages`
Accepts a single unstructured message for processing.

```json
{
  "id": "msg-001",
  "source": "email",
  "messageDate": "2025-06-15T10:30:00Z",
  "subject": "Re: Policy Inquiry",
  "from": "maria.garcia@email.com",
  "to": "agent@insurance.com",
  "body": "Dear Agent, my name is Maria García López. I was born on March 14, 1985..."
}
```

The pipeline must be **agnostic to message content and format** — it should handle emails, messages, and documents through the same extraction flow without hardcoded format-specific logic.

#### `GET /api/customers`
Returns all customer profiles with their most up-to-date data.

#### `GET /api/customers/:id`
Returns a single customer profile with full detail, including data history.

### 2. AI-Powered Extraction Pipeline

Design an **agent or workflow** that processes each incoming message through these stages:

1. **Extract** — Use an LLM to extract structured customer data from the unstructured text
2. **Search** — Find potential matching customers in the existing database
3. **Decide** — Determine whether to create a new customer or update an existing one
4. **Persist** — Save the extracted data with proper timestamps and source tracking

### 3. Conflict Resolution Rules

- When the **same field** appears in multiple messages, the value from the message with the **latest `messageDate`** wins
- All historical values must be preserved (not overwritten) for audit purposes
- Non-deterministic data **accumulates** — new inferences are added, not replaced
- Source attribution must be maintained (which message contributed which data point)

### 4. Security & Reliability

- **Idempotency**: Ingesting the same message twice (same `id`) must not create duplicates or corrupt the customer profile
- **Input validation**: The API must validate incoming payloads and reject malformed messages with appropriate error codes
- **Error resilience**: If the LLM extraction fails for a single message (e.g. timeout, rate limit, unintelligible content), the system must handle it gracefully — log the failure, return a meaningful error, and not leave the database in an inconsistent state
- **No data leakage**: Customer PII must not be exposed in logs or error responses. Be mindful of what gets logged when using LLM APIs
- **API key management**: LLM API keys and any other secrets must be configured via environment variables, never hardcoded in source code

### 5. Infrastructure

- The entire service must run via **Docker / Docker Compose**
- Include a `docker-compose.yml` that starts all required services
- The service should be fully functional with a single `docker compose up`
- Use any database of your choice (PostgreSQL, MongoDB, SQLite, etc.)

---

## Dataset

A sample dataset is provided in the `dataset/` directory containing **15 messages** across three types (emails, messages, documents) for **two fictional customers**:

- **Customer A** — Maria García López
- **Customer B** — Thomas Weber

The messages arrive in **non-chronological order** and contain overlapping, sometimes conflicting data. Your system must correctly reconcile all data points based on `messageDate`.

### Dataset Files

```
dataset/
├── emails/
│   ├── email-001.json
│   ├── email-002.json
│   ├── email-003.json
│   ├── email-004.json
│   └── email-005.json
├── messages/
│   ├── msg-001.json
│   ├── msg-002.json
│   ├── msg-003.json
│   ├── msg-004.json
│   └── msg-005.json
└── documents/
    ├── doc-001.json
    ├── doc-002.json
    ├── doc-003.json
    ├── doc-004.json
    └── doc-005.json
```

---

## How We Evaluate

> **Important — read this carefully.**

During evaluation, we will test your service by sending messages to your API **one by one** through the `POST /api/messages` endpoint. You should be aware of the following:

1. **Messages will NOT be sent in chronological order.** The ingestion order will be randomized. Your system must produce the correct customer profiles regardless of the order in which messages arrive.

2. **We will send 10 additional messages that are NOT included in the provided dataset.** These extra messages will contain new data, updates, and potentially new customers. Their content, format, and structure will not be disclosed in advance. Your pipeline must be robust and generic enough to handle **any** message — not just the 15 samples you have been given.

3. **The expected outcome is the same:** after all messages are processed (the 15 from the dataset + the 10 unknown ones), the `GET /api/customers` endpoint must return correct, up-to-date customer profiles with proper conflict resolution and full history.

**In short: do not hardcode anything. Do not tailor your extraction logic to the specific messages in the dataset. Build a system that works for any unstructured input.**

---

## Evaluation Criteria

### Context Engineering (40%)
- Quality of the AI extraction prompt(s) and pipeline design
- How well the system handles ambiguity and conflicting data
- Agent/workflow architecture and decision-making logic
- Source tracking and data lineage

### Data Model Design (20%)
- Separation of deterministic, mutable, and non-deterministic data
- History preservation and temporal resolution
- Schema design and extensibility

### Code Quality (20%)
- Clean, readable, well-structured code
- Error handling and edge cases
- Proper use of types/interfaces
- Test coverage (unit and/or integration)

### Infrastructure & DevEx (10%)
- Docker setup that works out of the box
- Clear documentation and setup instructions
- API design and usability

### Bonus Points (10%)
- Confidence scoring on extracted data
- Customer merge/deduplication strategy
- Observability (logging, tracing)
- Batch ingestion endpoint
- Dashboard or UI for viewing customer profiles

---

## LLM Access — Nebius AI Platform

We provide an API key for the **Nebius AI Platform**, giving you access to two models via an OpenAI-compatible API. You will receive the key separately — configure it as the `NEBIUS_API_KEY` environment variable.

### Available Models

| Model | Identifier | Base URL |
|---|---|---|
| **GPT-OSS-120B** | `openai/gpt-oss-120b` | `https://api.tokenfactory.nebius.com/v1/` |
| **Kimi-K2.5** | `moonshotai/Kimi-K2.5` | `https://api.tokenfactory.eu-west1.nebius.com/v1/` |

You are free to use either or both models. Since the API is OpenAI-compatible, you can use the standard OpenAI SDK:

#### GPT-OSS-120B

```javascript
const OpenAI = require('openai');

const client = new OpenAI({
    baseURL: 'https://api.tokenfactory.nebius.com/v1/',
    apiKey: process.env.NEBIUS_API_KEY,
});

const response = await client.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
        { role: "system", content: "SYSTEM_PROMPT" },
        { role: "user", content: "USER_MESSAGE" }
    ]
});
```

#### Kimi-K2.5

```javascript
const OpenAI = require('openai');

const client = new OpenAI({
    baseURL: 'https://api.tokenfactory.eu-west1.nebius.com/v1/',
    apiKey: process.env.NEBIUS_API_KEY,
});

const response = await client.chat.completions.create({
    model: "moonshotai/Kimi-K2.5",
    messages: [
        { role: "system", content: "SYSTEM_PROMPT" },
        { role: "user", content: "USER_MESSAGE" }
    ]
});
```

> **Note:** You must use the Nebius-provided models for this test. Do not use other LLM providers (OpenAI, Anthropic, etc.) as we will evaluate your solution using the provided API key.

---

## Tech Stack

You are free to choose your preferred technology stack. Here are some suggestions:

- **Language**: TypeScript
- **LLM**: Nebius AI Platform (see above — OpenAI-compatible SDK)
- **Database**: PostgreSQL, MongoDB, SQLite
- **Agent Framework**: LangChain, LangGraph, CrewAI, custom implementation

---

## Deliverables

1. **Source code** in a Git repository
2. **Working Docker setup** (`docker compose up` must start the service)
3. **README** with:
   - Architecture overview and design decisions
   - Setup instructions
   - API documentation
   - Example requests/responses
4. **Processed results**: After ingesting all 15 messages, the two customer profiles should be correctly reconstructed

---

## Getting Started

1. Clone this repository (NOT FORK)
2. Review the dataset in `dataset/`
3. Design your data model and extraction pipeline
4. Implement the service
5. Test by ingesting all messages and verifying the customer profiles
6. Dockerize everything
7. Document your decisions

---

## Time Expectation

This test is designed to be completed in **4–6 hours**. Delivered after 48 Hours. Focus on the core pipeline and data model first, then add refinements, improvements or nice to have.

Good luck! We look forward to seeing your approach to context engineering.
