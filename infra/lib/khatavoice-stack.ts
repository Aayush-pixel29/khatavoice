import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class KhataVoiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Single-Table DynamoDB Table
    const table = new dynamodb.Table(this, 'KhataVoiceTable', {
      tableName: 'KhataVoiceTable',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY // For dev / hackathon evaluation
    });

    // GSI1: Customer Transaction History
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // GSI2: Dues Leaderboard (Sorted by debt amount)
    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // GSI3: Daily Summary Rollup
    table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // 2. Serverless AWS Lambda MCP Server
    const serverFn = new lambda.Function(this, 'KhataVoiceFunction', {
      functionName: 'khata-voice-mcp-server',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambda.handler',
      code: lambda.Code.fromAsset(path.resolve(process.cwd(), '../server/dist')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        STORAGE_DRIVER: 'dynamodb',
        DYNAMODB_TABLE_NAME: table.tableName,
        BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
        NODE_OPTIONS: '--enable-source-maps'
      }
    });

    // 3. Grant Permissions
    table.grantReadWriteData(serverFn);

    // Bedrock InvokeModel permissions
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*']
      })
    );

    // 4. Lambda Function URL (Enables HTTPS streaming)
    const fnUrl = serverFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Or AWS_IAM
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*']
      },
      invokeMode: lambda.InvokeMode.BUFFERED
    });

    // Stack Outputs
    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: table.tableName,
      description: 'DynamoDB Single Table Name'
    });

    new cdk.CfnOutput(this, 'MCPFunctionUrl', {
      value: fnUrl.url,
      description: 'Remote HTTPS endpoint for MCP 2025-11-25 Server'
    });
  }
}
