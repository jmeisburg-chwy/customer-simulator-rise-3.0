# Customer Simulator Rise - Codex Handoff

## Current Repository State

- Repo: `jmeisburg-chwy/customer-simulator-rise`
- Local path: `/Users/jmeisburg/Developer/customer-simulator-rise`
- Active branch: `codex/s3-scenario-library-migration`
- Draft PR: `https://github.com/jmeisburg-chwy/customer-simulator-rise/pull/2`
- Base branch: `main`

The branch currently contains the Rise S3 scenario-library migration:

- `Lambda.js` no longer uses embedded scenario data at runtime.
- Runtime scenario contract is:
  - `index.json` lists available scenarios.
  - `scenarios/{normalized_scenario_id}.json` contains one single scenario object.
  - Batch array files are not supported by the Rise runtime.
- `GET /scenario`, `POST /chat-turn`, `POST /session`, and `POST /evaluate` must load only the requested scenario object.
- Unknown scenario ids must show/return "Scenario unavailable" and must not silently fall back.
- Rise remains learner-only: no auth/Cognito, no manager preview, no scenario upload/publish routes, no dashboards, no required local platform assets.

## Important Local Hygiene

Before making changes in a new Codex session:

```bash
cd /Users/jmeisburg/Developer/customer-simulator-rise
git status -sb --untracked-files=all
git branch --show-current
gh auth status
aws sts get-caller-identity
```

Ignore `.DS_Store`. Do not stage it.

If `NEW_THREAD_HANDOFF.md` is untracked or modified, read it before editing. It is intended to be committed to the PR branch.

## Required Test Command

Run this before every commit and before every deploy:

```bash
node tests/behavior-framework.test.js
```

Expected result: every test prints `ok`.

## GitHub Workflow After Any Code Change

After changing code or docs:

```bash
git status -sb
node tests/behavior-framework.test.js
git add <only intended files>
git commit -m "<clear message>"
git push
```

Keep using the existing PR branch unless the user asks for a new branch:

```bash
codex/s3-scenario-library-migration
```

Do not push directly to `main` unless the user explicitly asks for that.

## AWS Target To Verify Before Any Deploy

Only deploy to this Lambda unless the user explicitly changes the target:

```text
FunctionName: cc-customer-simulator-v2
FunctionArn: arn:aws:lambda:us-east-2:650251728997:function:cc-customer-simulator-v2
Region: us-east-2
Account: 650251728997
Runtime: nodejs24.x
Handler: index.handler
PackageType: Zip
```

Verify target before every deploy:

```bash
aws lambda get-function \
  --function-name cc-customer-simulator-v2 \
  --region us-east-2 \
  --query '{FunctionName:Configuration.FunctionName,FunctionArn:Configuration.FunctionArn,Runtime:Configuration.Runtime,Handler:Configuration.Handler,PackageType:Configuration.PackageType,LastModified:Configuration.LastModified,CodeSha256:Configuration.CodeSha256,RevisionId:Configuration.RevisionId,State:Configuration.State,LastUpdateStatus:Configuration.LastUpdateStatus}' \
  --output json
```

There are other simulator Lambdas in the account. Do not deploy to these unless specifically requested:

- `customer-simulator-prod-cc-customer-simulator`
- `cc-customer-simulator-library-prototype`

## AWS Deploy Rules

No AWS update should happen without:

1. Confirming the target function is `cc-customer-simulator-v2`.
2. Running `node tests/behavior-framework.test.js`.
3. Packaging `Lambda.js` as `index.js`, because the Lambda handler is `index.handler`.
4. Updating code only unless the user explicitly asks to change configuration.
5. Waiting for Lambda update completion.
6. Re-reading the function metadata after deploy and reporting the new `LastModified`, `CodeSha256`, and `RevisionId`.

Do not print or copy secrets. The Lambda currently has sensitive environment variables in AWS. Avoid commands that dump full environment configuration unless absolutely necessary.

## S3 Migration Deployment Caveat

The S3 migration requires more than code if the live Lambda does not already have:

- `SCENARIO_LIBRARY_BUCKET`
- optional `SCENARIO_LIBRARY_PREFIX`
- IAM permission for read-only S3 access:
  - `s3:GetObject` on `customer-simulator-prod-scenariolibrarybucket-o67zkqye4eaj/*`
  - `s3:ListBucket` on `customer-simulator-prod-scenariolibrarybucket-o67zkqye4eaj`

Before deploying the S3 migration to AWS, verify configuration and permissions. If missing, update via approved infrastructure workflow or ask the user before changing Lambda configuration/IAM directly.

## Recommended Deploy Script Design

If asked to add deploy automation, create `scripts/deploy-lambda.sh` with these behaviors:

- Default function: `cc-customer-simulator-v2`
- Default region: `us-east-2`
- Refuse to deploy to another function unless an explicit override flag is passed.
- Support `--dry-run`.
- Run `node tests/behavior-framework.test.js` before packaging.
- Create a temporary package directory.
- Copy `Lambda.js` to `index.js`.
- Zip only `index.js` unless additional runtime files are later required.
- Run:

```bash
aws lambda update-function-code \
  --function-name cc-customer-simulator-v2 \
  --region us-east-2 \
  --zip-file fileb://<zip-path>

aws lambda wait function-updated \
  --function-name cc-customer-simulator-v2 \
  --region us-east-2
```

- Fetch post-deploy metadata with `aws lambda get-function`.

## Current Known Verification

Previously run successfully on this branch:

```bash
node tests/behavior-framework.test.js
```

All 23 tests passed at that time.

## Next Likely Steps

1. Commit this handoff document to the existing PR branch.
2. If requested, add the deploy script and tests/docs for it.
3. Verify the live Lambda configuration and IAM before deploying the S3 migration.
4. Push every meaningful repo change to GitHub so there is a rollback point.
