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

## Current Scripted Chat Response Fix

`Lambda.js` includes a scripted-response fix for chat scenarios where the AI customer was under-responding to manager-approved `customerResponse` text.

Exact implementation details:

- `normalizeChatStepProgression()` preserves `customerResponse` when converting legacy `successSignals` / `phrases` / `keyPhrases` into `match.any contains_any` rules.
- `normalizeUploadedScenario()` mirrors `scenario.chatConfig.stepProgression` into `scenario.simulation.stateModel.chatStepProgression`, so the runtime has one normalized progression source.
- `buildScenarioClientConfig()` now includes `label` and `customerResponse` for each returned `chatConfig.stepProgression` step, in addition to `id` and `match`.
- `buildCustomerBehaviorRules(s)` computes `baseScenarioId` by normalizing the scenario id and stripping a trailing `_chat` or `_voice`, then appends both exact-id and base-id rule sets. This lets `delivery_promise_miss_10_partial_refund_chat` use the shared `delivery_promise_miss_10_partial_refund` rules.
- `buildChatInstructions(s, currentStep)` looks up the current step from `simulation.stateModel.chatStepProgression` first, then `chatConfig.stepProgression`, by exact `id` or array index.
- When the current step has `customerResponse`, `buildChatInstructions()` injects a `SCRIPTED RESPONSE RULE` block telling the model to use that response exactly or extremely closely, not shorten it, not summarize it, and not remove details such as pet name, breed, birthday, address, timing concern, refund preference, or closing appreciation.
- The chat style rule now allows longer responses when a manager-approved scripted response exists for the current step.
- The `/chat-turn` handler independently checks the current step for `customerResponse` and sends `text.verbosity: "high"` to OpenAI for scripted steps; otherwise it keeps `text.verbosity: "low"`.
- The scripted response block now explicitly says that the current scripted response overrides the closing line, general closing guidance, and generic customer behavior rules. This guards against premature closes when a scenario has a `closingLine` but the active step is not the closing step.
- `ArticulateRise-ChatExperience.html` fixes the client-side progression order. Previously, `sendMessage()` advanced `currentStep` before calling `/chat-turn`, so a matched step 0 agent message sent `currentStep: 1` to Lambda and the AI customer replied with the next beat. The frontend now captures `responseStep = currentStep`, sends that step to Lambda, and advances to `nextStep` only after the customer reply is successfully appended.
- The no-API fallback reply path now indexes `FALLBACK_CUSTOMER_REPLIES` by `responseStep` instead of `currentStep - 1`.

Support notes:

- The first known failing beat is the `delivery_promise_miss_10_partial_refund_chat` step where the customer should give Rocky's full puppy/birthday/planning context instead of replying only "Rocky" or "His name is Rocky."
- The current tests cover scenario normalization, preservation of `customerResponse` through legacy step normalization, mirroring `chatConfig.stepProgression` into the state model, `buildScenarioClientConfig()` preserving scripted responses, and the chat frontend sending the matched step to Lambda before advancing progression. They do not directly exercise the live `/chat-turn` `textVerbosity` branch.
- The Lambda does not currently log the full chat system prompt or selected `text.verbosity` on successful `/chat-turn` requests. CloudWatch will not prove `SCRIPTED RESPONSE RULE` or `text.verbosity: "high"` without adding temporary debug logging.
- If the issue persists after deployment, add temporary targeted logging for `scenario.id`, `currentStep`, whether `currentStepConfig.customerResponse` is present, and the selected `textVerbosity`. Do not log secrets or full customer transcripts.
- The local chat scenario JSON at `/Users/jmeisburg/Downloads/scenario-1/on_time_delivery_no_partial_refund_needed_chat.json` has been updated to remove the extra "Can you send me the tracking link?" customer beat. After the learner confirms `1234 Elm Street in El Paso`, step 2 now asks `What happens if this order doesn't arrive on time?`, step 3 says `Perfect, that helps a lot.`, and step 4 closes only after the learner offers final help.

## Current Voice Customer Beat Fix

`Lambda.js` now includes ordered customer beats in realtime voice instructions.

Exact implementation details:

- `buildRealtimeInstructions()` adds an `APPROVED CUSTOMER BEATS` block when a scenario contains ordered customer beat data.
- Runtime voice beat source priority is:
  - `simulation.stateModel.voiceStepProgression`
  - fallback to `simulation.approvedTranscript`
- Each beat can define `customer` or `customerResponse`, plus `guidance` / `label` and `idealAgentResponse` / `trigger`.
- The prompt tells the realtime customer to follow beats in order, use the customer wording exactly or very closely, avoid skipping ahead, and reveal a beat only when the learner naturally prompts it or completes the expected action.
- The local voice scenario JSON at `/Users/jmeisburg/Downloads/scenario-1/on_time_delivery_no_partial_refund_needed_voice.json` has been updated with six `simulation.stateModel.voiceStepProgression` beats for Demarco and Larry's on-time delivery scenario.

Support notes:

- `ArticulateRise-VoiceExperience.html` does not manage `currentStep`; voice sequencing is controlled by the Lambda realtime prompt and scenario JSON.
- The test suite covers that realtime voice instructions include runtime customer beats in order.

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

There are other simulator Lambdas in the account. Do not ever deploy to them.

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

All 27 tests passed most recently after the scripted chat response, frontend progression fix, voice customer beat fix, and on-time delivery chat sequence update.

## Next Likely Steps

1. Commit this handoff document to the existing PR branch.
2. If requested, add the deploy script and tests/docs for it.
3. Verify the live Lambda configuration and IAM before deploying the S3 migration.
4. Push every meaningful repo change to GitHub so there is a rollback point.
