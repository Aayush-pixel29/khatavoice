#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = require("aws-cdk-lib");
const khatavoice_stack_1 = require("../lib/khatavoice-stack");
const app = new cdk.App();
new khatavoice_stack_1.KhataVoiceStack(app, 'KhataVoiceStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
    },
    description: 'KhataVoice MCP Server on AWS Lambda, Bedrock and DynamoDB'
});
