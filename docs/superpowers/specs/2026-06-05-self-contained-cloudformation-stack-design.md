# Self-Contained CloudFormation Stack Design

## Goal

Make the Customer Simulator CloudFormation stack usable by another team that starts with no existing AWS resources. The launch flow should require only a stack name, an OpenAI API key, and the standard IAM acknowledgement. After `CREATE_COMPLETE`, the stack's `ApiUrl` output should serve `GET /scenarios` successfully.

## Context

The current Rise runtime reads scenarios from an S3 scenario library:

- `index.json` lists available scenarios.
- `scenarios/{normalized_scenario_id}.json` contains one single scenario object.
- Batch array files are not supported at runtime.

The current `template.yaml` already passes a scenario bucket name into Lambda and grants read-only S3 permissions. It still assumes important resources exist outside the stack, including the scenario library bucket, seeded scenario objects, and the coaching DynamoDB table.

## Proposed Stack Behavior

The CloudFormation template should create everything a new team needs for a working starter backend:

- A dedicated S3 scenario library bucket owned by the stack.
- Seeded scenario library objects:
  - `index.json`
  - `scenarios/late_delivery_20_partial_refund_chat.json`
  - `scenarios/late_delivery_20_partial_refund.json`
- A DynamoDB coaching table compatible with the Lambda's current write shape.
- The Lambda execution role with least-necessary access to:
  - write CloudWatch logs
  - read the stack-owned S3 scenario library
  - write coaching records to the stack-owned DynamoDB table
- Lambda environment variables wired from stack-created resources:
  - `OPENAI_API_KEY`
  - `COACHING_TABLE`
  - `SCENARIO_LIBRARY_BUCKET`
  - `SCENARIO_LIBRARY_PREFIX`
- The existing HTTP API Gateway and Lambda permission.
- Outputs for:
  - `ApiUrl`
  - `ScenarioLibraryBucketName`
  - `CoachingTableName`

## Scenario Seeding Approach

Use CloudFormation-native resources where practical, but do not embed very large scenario JSON blobs directly into the main template if that makes the template hard to maintain.

Recommended implementation:

- Add a small Lambda-backed custom resource that seeds S3 objects during stack create/update.
- Package the seeding code with the deployment artifact or inline it only if it stays small and readable.
- Read scenario seed files from repo paths under `scenarios/` during packaging, then upload them to the new bucket.
- Generate `index.json` from the seeded scenario files so it cannot drift from the scenario objects included with the stack.

The custom resource should be idempotent. Updating the stack should safely refresh starter objects without deleting unrelated scenario files a team may have added later.

## DynamoDB Table Shape

Create a table that matches the Lambda's current primary key requirements:

- Partition key: `agentId`
- Sort key: `endedAt_sessionId`
- Billing mode: pay-per-request

The stack should set `COACHING_TABLE` to the created table's name. It should not assume the shared `RoleplayCoaching` table exists.

## Parameters

Keep the default launch path simple:

- Required:
  - `OpenAIApiKey`
- Optional, with defaults:
  - `ScenarioLibraryPrefix`, default empty

Do not ask new teams for a scenario bucket name. They will not have one.

## Deployment And Update Safety

The template must remain safe for the existing PR branch and AWS workflow:

- Do not deploy from Codex unless AWS auth is valid and the handoff deploy checks pass.
- Do not change the live Lambda target outside the approved deployment process.
- Do not print or store OpenAI API keys.
- Do not delete scenario objects that are not part of the starter seed set.
- Use stack-created resource names or CloudFormation-generated names where possible to avoid global S3 bucket naming collisions.

## Testing

Local tests should cover the template and runtime assumptions without requiring AWS credentials:

- The behavior test command remains `node tests/behavior-framework.test.js`.
- Add assertions that `template.yaml` creates an S3 bucket for the scenario library.
- Add assertions that Lambda receives `SCENARIO_LIBRARY_BUCKET` from the stack-created bucket.
- Add assertions that the role grants S3 read access only to the stack-created bucket.
- Add assertions that the template creates a DynamoDB table and wires `COACHING_TABLE` to it.
- Add assertions that expected outputs include `ApiUrl`, `ScenarioLibraryBucketName`, and `CoachingTableName`.

Manual verification after implementation and deployment:

1. Create or update a test stack from the template.
2. Confirm stack status is `CREATE_COMPLETE` or `UPDATE_COMPLETE`.
3. Open the stack outputs.
4. Visit `${ApiUrl}/scenarios`.
5. Confirm JSON lists the seeded starter scenarios.

## Out Of Scope

- Manager dashboards.
- Cognito or other learner authentication.
- Scenario upload or publishing routes.
- Automated OpenAI API key provisioning.
- Sharing the existing production scenario bucket with new teams.
- Migrating existing stack data between buckets or DynamoDB tables.

## User-Facing Tutorial Impact

The intended tutorial can stay simple:

1. Open the launch link.
2. Enter stack name.
3. Paste OpenAI API key.
4. Click through the defaults.
5. Acknowledge IAM resources.
6. Create the stack.
7. Copy `ApiUrl` from outputs.
8. Test `${ApiUrl}/scenarios`.

The tutorial can mention `ScenarioLibraryBucketName` only as the place to upload future scenarios after the starter stack is working.
