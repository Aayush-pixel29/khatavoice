# KhataVoice Developer Friction Log & Learnings

## Purpose
This document logs engineering friction, nuances discovered while implementing the Model Context Protocol (MCP 2025-11-25) specification, and AWS serverless considerations for voice-first AI agents.

---

### Friction 1: Canonical Streamable HTTP (POST /mcp) vs. Legacy SSE Transport
- **Context**: Standard desktop MCP tools rely on `stdio` pipes, whereas cloud agents (Alexa+, Claude, Bedrock) require remote HTTPS transport.
- **Discovery**: Early implementations used the legacy SSE pattern (`GET /mcp/sse` + `POST /mcp/message?sessionId=...`). However, MCP Specification 2025-11-25 canonical Streamable HTTP unifies communication into `POST /mcp`. Attempting to claim the legacy dual-endpoint SSE pattern was Streamable HTTP caused protocol incompatibility with compliant Alexa+ gateways.
- **Solution**: Migrated to canonical `POST /mcp` powered by the official `@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`), providing stateless execution with optional `GET /mcp` and `DELETE /mcp`. Legacy routes (`/mcp/sse`, `/mcp/message`) are retained strictly as backward-compatibility aliases.

---

### Friction 5: Official MCP SDK Stateless Transport Lifecycle & Accept Negotiation
- **Context**: For AWS Lambda serverless execution, stateful sessions introduce cross-container routing failure modes. We configured `sessionIdGenerator: undefined` for Stateless Streamable HTTP.
- **Discovery**: The official SDK enforces that a stateless `StreamableHTTPServerTransport` cannot be reused across consecutive HTTP requests (`Error: Stateless transport cannot be reused across requests`). Furthermore, the SDK strictly requires the `Accept` header to permit both `application/json` and `text/event-stream`, returning HTTP 406 if only `application/json` is sent.
- **Solution**: We created a per-request factory in `handleStreamableHttpRequest` that binds a lightweight `Server` + `StreamableHTTPServerTransport` pair to the shared, singleton `ILedgerStore` on every request. We also implemented header normalization for `Accept: application/json, text/event-stream` to ensure universal client compatibility.

---

### Friction 2: Alexa+ Toolkit General Access Constraints
- **Context**: The Amazon Alexa+ Add-on Toolkit is currently not open for general public enrollment to hackathon participants.
- **Pitfall**: Attempting to create mock Alexa+ skill packages with fake credentials leads to broken or unverifiable demos for judges.
- **Solution**: We built KhataVoice strictly to the published MCP server contract that Alexa+ Add-ons consume, and created an in-house voice web client with Web Speech API and live MCP protocol inspection. This guarantees 100% genuine, verifiable functionality without fake mocks.

---

### Friction 3: Local Dev Without Cloud Friction (The "Zero-Creds" Rule)
- **Context**: Hackathon judges often test code locally. Forcing judges to configure AWS credentials, IAM policies, or local DynamoDB Docker containers kills adoption and risks failed evaluations.
- **Solution**: We adopted the Repository Pattern with `ILedgerStore`. By default (`STORAGE_DRIVER=memory`), the server boots an `InMemoryStore` populated with realistic Kirana store seed records. Judges can clone and run `npm run dev` in under 10 seconds.

---

### Friction 4: Single-Table DynamoDB TransactWriteItems vs. Performance
- **Context**: Ledger transactions require strong consistency. Updating customer balances and daily summaries asynchronously via DynamoDB Streams introduces eventual consistency lag, which confuses users querying balance immediately after adding an entry.
- **Solution**: Implemented `TransactWriteItems` to execute transaction append, customer balance updates, and daily summary increments atomically in a single round-trip.

---

### Friction 6: Atomic Mutation Idempotency in DynamoDB Transactions
- **Context**: Retrying network requests or voice reconnects can send the same transaction multiple times. Merely doing a `GetItem` check before writing leaves a race window under concurrent execution.
- **Discovery**: DynamoDB allows embedding a conditional `Put` inside `TransactWriteItems`. By writing an idempotency token with `ConditionExpression: attribute_not_exists(PK)`, DynamoDB guarantees that if two requests arrive simultaneously, exactly one succeeds and the other receives `TransactionCanceledException (ConditionalCheckFailed)`, aborting all balance mutations atomically.
- **Solution**: Implemented an idempotency record item with a 24-hour TTL in `TransactWriteItems`. Upon catching conditional check cancellation, the store retrieves the existing transaction record and returns it cleanly with `isDuplicate: true`.

---

### Friction 7: Production Bearer Authentication vs. Zero-Credential Hackathon Evaluation
- **Context**: Cloud endpoints exposed to Alexa+ require security against unauthorized invocation. However, forcing evaluators to configure and pass API keys in local dev destroys the zero-friction clone-and-run developer experience.
- **Solution**: Implemented tiered authentication in `mcpAuthMiddleware`. When `NODE_ENV=production` or `MCP_API_KEY` is present, strict `Authorization: Bearer <MCP_API_KEY>` is enforced and returns HTTP 401 with standard JSON-RPC `-32000` errors on violation. When running locally without a key configured, authentication is bypassed seamlessly.
