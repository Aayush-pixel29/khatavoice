# KhataVoice AWS Infrastructure (CDK)

This directory contains the AWS Cloud Development Kit (CDK) TypeScript definitions for deploying KhataVoice to AWS.

## Resources Deployed
1. **Amazon DynamoDB Single-Table (`KhataVoiceTable`)**:
   - On-Demand capacity mode (`PAY_PER_REQUEST`).
   - Primary key: `PK` (string) + `SK` (string).
   - `GSI1`: Customer transaction history.
   - `GSI2`: Outstanding debt ranking (sparse index).
   - `GSI3`: Date-based daily summary rollup.
2. **AWS Lambda Function (`khata-voice-mcp-server`)**:
   - Node.js 20.x runtime.
   - Direct execution of MCP tools and Bedrock orchestration.
3. **Lambda Function URL**:
   - Exposes public HTTPS endpoint for remote MCP agents.
4. **IAM Role & Policies**:
   - Least privilege access for DynamoDB CRUD and Bedrock `InvokeModel`.

## Deployment Instructions

```bash
# 1. Build server bundle first
cd ../server
npm run build

# 2. Deploy CDK Stack
cd ../infra
npm install
npx cdk bootstrap # if running for the first time in your AWS account
npx cdk deploy
```

Upon completion, CDK outputs the `MCPFunctionUrl` which can be supplied directly to any MCP client or cloud agent.
