#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KhataVoiceStack } from '../lib/khatavoice-stack';

const app = new cdk.App();
new KhataVoiceStack(app, 'KhataVoiceStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  description: 'KhataVoice MCP Server on AWS Lambda, Bedrock and DynamoDB'
});
