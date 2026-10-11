# Architecture Decision Records (ADRs)

## ADR-001: Model Context Protocol (MCP) Version and Transport Selection
- **Status**: Superseded by ADR-005
- **Context**: The server must support remote agent invocation from cloud-hosted voice assistants (e.g., Alexa+, Claude, Bedrock). Stdio is local-only.
- **Initial Decision**: Legacy SSE transport (`GET /mcp/sse` + `POST /mcp/message`).
- **Shortcoming**: Legacy SSE splits the protocol across two distinct endpoints with session query parameters, violating the canonical Streamable HTTP specification required for Alexa+ and MCP 2025-11-25.

---

## ADR-005: Migration to Canonical Stateless Streamable HTTP (MCP 2025-11-25)
- **Status**: Accepted
- **Context**: The Alexa+ hackathon and MCP Specification 2025-11-25 require canonical Streamable HTTP (`POST /mcp`) rather than legacy multi-route SSE. AWS Lambda serverless execution requires stateless, shared-nothing request handling.
- **Decision**:
  1. Adopt the official `@modelcontextprotocol/sdk` TypeScript transport (`StreamableHTTPServerTransport` for Express and `WebStandardStreamableHTTPServerTransport` for Lambda).
  2. Implement canonical `POST /mcp` as the primary transport endpoint with `sessionIdGenerator: undefined` (Stateless Streamable HTTP).
  3. Support optional `GET /mcp` (SSE stream response) and `DELETE /mcp` (session cleanup).
  4. Retain financial ledger state strictly within `LedgerStore` / DynamoDB; never retain financial state in transport memory.
  5. Retain `GET /mcp/sse` and `POST /mcp/message` strictly as explicitly labeled *LEGACY SSE COMPATIBILITY* routes.
- **Consequences**: Strict compliance with MCP Specification 2025-11-25, 100% serverless scale on AWS Lambda without session affinity bottlenecks, robust JSON-RPC 2.0 error handling, and DNS rebinding / host validation protection.

---

## ADR-002: Dual-Driver Storage Architecture (Repository Pattern)
- **Status**: Accepted
- **Context**: The project must run locally with zero AWS credentials, while remaining production-ready on AWS DynamoDB.
- **Decision**: Define an `ILedgerStore` interface. Implement `InMemoryStore` for local development and `DynamoDBStore` for cloud deployment. Selection is governed by `STORAGE_DRIVER=memory|dynamodb`.
- **Consequences**: Immediate out-of-the-box evaluation without cloud setup, zero test flakiness, and seamless production parity.

---

## ADR-003: DynamoDB Single-Table Design with Atomic TransactWriteItems
- **Status**: Accepted
- **Context**: A financial ledger requires strong ACID guarantees when recording transactions and updating running balances.
- **Decision**: Model all entities (`MERCHANT`, `CUSTOMER`, `TRANSACTION`, `DAILY_SUMMARY`) into a single table with GSIs for debtor ranking and daily rollups. Use `TransactWriteItems` to execute transaction insertions and balance mutations atomically.
- **Consequences**: Sub-10ms read/write latency, zero eventual consistency race conditions for customer balance queries, and cost-effective on-demand billing.

---

## ADR-004: Direct Speech & MCP Inspector Web Client
- **Status**: Accepted
- **Context**: Alexa+ Add-on Toolkit access is restricted for hackathon participants.
- **Decision**: Build a purpose-built voice web client featuring the Web Speech API and an interactive MCP Inspector that exposes real-time JSON-RPC 2.0 frames.
- **Consequences**: Provides judges with a 100% genuine, verifiable voice interface and transparent insight into the underlying MCP protocol execution.

---

## ADR-006: At-Most-Once Mutation Idempotency for add_entry
- **Status**: Accepted
- **Context**: Network retries from voice assistants (e.g. Alexa+) or client reconnections can submit duplicate `add_entry` requests, risking double-debiting or double-crediting merchants.
- **Decision**:
  1. Add `idempotency_key` and alias `client_request_id` to `add_entry` schema.
  2. Implement a 24-hour deduplication policy.
  3. Enforce atomicity in DynamoDB via `TransactWriteItems` with a conditional `Put` on `IDEMP#<customerSlug>#<key>` (`attribute_not_exists(PK)`).
  4. On repeated invocations, abort mutation atomically, fetch the original transaction and balance, and return an idempotent response with `isDuplicate: true`.
  5. In InMemoryStore, maintain a thread-safe / concurrent promise map with 24-hour expiration.
- **Consequences**: Zero accidental double-mutations, strong consistency guarantees across concurrent requests, and instant idempotent retries.

---

## ADR-007: Production Bearer Token Authentication for Remote MCP Endpoint
- **Status**: Accepted
- **Context**: Remote cloud endpoints exposed to the public internet must restrict access to authorized clients (e.g., Alexa+ gateway) while maintaining frictionless zero-credential local evaluation.
- **Decision**:
  1. In production (`NODE_ENV=production` or when `MCP_API_KEY` is set), require `Authorization: Bearer <MCP_API_KEY>`. Reject unauthenticated requests with HTTP 401.
  2. In local development (`NODE_ENV=development` with no key set), allow zero-credential requests.
  3. Never log API keys or tokens. Never expose `MCP_API_KEY` to browser client bundles.
  4. Retain strict CORS and Host validation (DNS rebinding defense) in addition to Bearer authentication.
- **Consequences**: Enterprise-grade security for cloud deployments while maintaining immediate local clone-and-run evaluation.
