# KhataVoice 🎙️📖

> **Production-Quality Voice-First MCP Server for Small-Business Financial Operations**  
> Built for the **Amazon Alexa+** and **AWS Builder** Track.  
> Adheres to **MCP Specification 2025-11-25** (Canonical Streamable HTTP transport via `POST /mcp`).

---

## 🌟 Problem & Vision
Across India and emerging markets, over **60 million micro-retailers (*kirana* stores, vendors, tradespeople)** manage daily credit (*udhaar*) and debit (*jama*) using physical paper notebooks (*khatas*). During peak hours, manually writing down transactions or tapping through complex app menus causes operational delays, cash leakage, and forgotten dues.

**KhataVoice** transforms bookkeeping into a natural voice experience. By speaking naturally in Hindi, Hinglish, or English (e.g., *"Ramesh ne 500 rupaye jama kiye"*, *"Kitna udhaar baaki hai?"*), merchants can:
1. Record credit and debit entries in under 2 seconds.
2. Query customer and store balances instantaneously.
3. Track overdue receivables and send polite WhatsApp reminders with UPI links.
4. Generate end-of-day reconciliation summaries hands-free.

---

## 🏗️ Architecture & Stack

- **MCP Specification**: `2025-11-25` (Stateless Streamable HTTP via canonical `POST /mcp`, built with official `@modelcontextprotocol/sdk`).
- **AI Agent Orchestration**: Amazon Bedrock Converse API (Claude 3.5 Sonnet / Haiku, Amazon Nova).
- **Serverless Compute**: AWS Lambda (Node.js 20.x, Function URLs with streaming response).
- **Cloud Persistence**: Amazon DynamoDB Single-Table Design (`KhataVoiceTable`) with ACID transactions (`TransactWriteItems`).
- **Local Development**: Built-in `InMemoryStore` with seed merchant data—**runs locally with zero AWS credentials**.
- **Voice Demo Client**: React + Vite web dashboard featuring speech recognition and a live **MCP Protocol Inspector** sending real `POST /mcp` requests.

---

## 🛠️ The 4 Core MCP Tools

| Tool | Description | Parameters |
|---|---|---|
| `add_entry` | Records a credit (*jama*) or debit (*udhaar*) transaction | `customer_name`, `amount`, `type` (`credit`\|`debit`), `customer_phone`, `description`, `date` |
| `get_balance` | Gets balance for a specific customer or store-wide | `customer_name` (optional) |
| `get_dues` | Lists ranked debtors with outstanding balances | `min_amount`, `limit` |
| `daily_summary` | End-of-day closing financial statement | `date` (YYYY-MM-DD) |

---

## 🚀 Quickstart (Local Dev - Zero AWS Credentials Required)

```bash
# 1. Clone the repository
git clone https://github.com/your-org/khata-voice.git
cd khata-voice

# 2. Install dependencies across workspaces
npm install

# 3. Start local server & web app simultaneously
npm run dev
```

- **MCP Server**: Runs at `http://localhost:3001`
  - Canonical MCP Endpoint: `POST http://localhost:3001/mcp` (Streamable HTTP, MCP 2025-11-25)
  - Optional Streamable HTTP: `GET http://localhost:3001/mcp`, `DELETE http://localhost:3001/mcp`
  - Health check: `GET http://localhost:3001/health`
  - Legacy SSE Compatibility: `GET /mcp/sse`, `POST /mcp/message` (retained for backward compatibility only)
- **Voice Demo Client**: Runs at `http://localhost:5173`

---

## 🧪 Testing

Run comprehensive unit and protocol contract tests:

```bash
npm run test
```

---

## ☁️ AWS Cloud Deployment

See [infra/README.md](file:///d:/khatavoice/infra/README.md) for AWS CDK deployment scripts deploying the DynamoDB single-table, Lambda function with streaming Function URL, and Bedrock IAM policies.

---

## 📄 License
This project is licensed under the Apache 2.0 License. See [LICENSE](file:///d:/khatavoice/LICENSE).
