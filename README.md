# Customer Simulator Rise

Chewy Customer Simulator Rise is a browser/Rise training package with one Node.js Lambda backend, separate chat and voice frontends, and an S3-backed scenario library.

The current main branch is designed for the safer next-generation/test Lambda first. Do not deploy these changes to the live `cc-customer-simulator-v2` Lambda until they have been validated and intentionally cut over.

## What Is In This Repo

- `Lambda.js` - Lambda handler for scenarios, chat turns, Realtime voice sessions, evaluation, and coaching persistence.
- `ArticulateRise-ChatExperience.html` - standalone chat experience for Articulate Rise or browser testing.
- `ArticulateRise-VoiceExperience.html` - standalone voice experience for Articulate Rise or browser testing.
- `scenarios/late_delivery_20_partial_refund_chat.json` - chat-only late delivery runtime scenario.
- `scenarios/late_delivery_20_partial_refund.scenario.json` - voice-only late delivery runtime scenario source.
- `tests/behavior-framework.test.js` - local behavior/config regression checks.
- `tests/calibration/` - offline trainer-scored calibration fixtures and optional live `/evaluate` comparison script.
- `scenario-authoring-guide.md`, `scenario-template.json`, and `gpt-scenario-generation-prompt.md` - scenario authoring helpers.
- `template.yaml` - CloudFormation/SAM-style reference template. Treat it as infrastructure reference unless you intentionally choose to deploy it.

There is no npm package install step for the current local scripts. They use Node.js built-ins.

## Runtime Flow

1. A Rise HTML file resolves `apiBase` and `scenarioId`.
2. The frontend calls `GET /scenario` to load scenario config from Lambda.
3. Lambda loads the requested scenario from the S3 scenario library.
4. Chat uses `POST /chat-turn` for customer replies.
5. Voice uses `POST /session` to create an OpenAI Realtime WebRTC session.
6. Chat and voice both send the final transcript to `POST /evaluate`.
7. Both experiences can save structured coaching records through `POST /coaching`.

## Rise Configuration

Both Rise files require an explicit `scenarioId`. If no scenario ID is provided, the simulator stops and shows a clear scenario unavailable message.

`apiBase` resolution order:

1. URL query parameter: `?apiBase=...`
2. `window.CCS_CONFIG.apiBase`
3. Baked-in `DEFAULT_API_BASE`

`scenarioId` resolution order:

1. URL query parameter: `?scenarioId=...`
2. `window.CCS_CONFIG.scenarioId`
3. `SCENARIO_OVERRIDE`, only when intentionally set for a locked package

Example chat test URL:

```text
ArticulateRise-ChatExperience.html?apiBase=TEST_API_BASE&scenarioId=late_delivery_20_partial_refund_chat
```

Example voice test URL:

```text
ArticulateRise-VoiceExperience.html?apiBase=TEST_API_BASE&scenarioId=late_delivery_20_partial_refund
```

Host-page configuration is also supported:

```html
<script>
  window.CCS_CONFIG = {
    apiBase: "https://test-api-id.execute-api.us-east-2.amazonaws.com",
    scenarioId: "late_delivery_20_partial_refund_chat"
  };
</script>
```

## S3 Scenario Library

Runtime scenario files are single scenario objects. Batch arrays are not supported by the Rise runtime.

Expected S3 keys for the current late delivery package:

- `scenarios/late_delivery_20_partial_refund_chat.json`
  - source file: `scenarios/late_delivery_20_partial_refund_chat.json`
  - scenario id: `late_delivery_20_partial_refund_chat`
  - channels: `["chat"]`
- `scenarios/late_delivery_20_partial_refund.json`
  - source file: `scenarios/late_delivery_20_partial_refund.scenario.json`
  - scenario id: `late_delivery_20_partial_refund`
  - channels: `["voice"]`

`index.json` should include a `scenarios` array for discovery. Lambda loads scenario bodies from `scenarios/{scenario_id}.json`, so the index entries are metadata:

```json
{
  "scenarios": [
    {
      "id": "late_delivery_20_partial_refund_chat",
      "title": "Late Delivery, 20% Partial Refund",
      "channels": ["chat"],
      "status": "active"
    },
    {
      "id": "late_delivery_20_partial_refund",
      "title": "Late Delivery, 20% Partial Refund",
      "channels": ["voice"],
      "status": "active"
    }
  ]
}
```

The chat scenario owns chat step progression gates. The voice scenario is voice-only and no longer advertises outdated chat progression fields.

## Lambda API

Required API routes:

- `GET /scenarios`
- `GET /scenario`
- `POST /chat-turn`
- `POST /session`
- `POST /evaluate`
- `POST /coaching`

Required Lambda environment variables:

- `OPENAI_API_KEY`
- `COACHING_TABLE`
- `AWS_REGION`
- `SCENARIO_LIBRARY_BUCKET`
- `SCENARIO_LIBRARY_PREFIX` optional
- `INGEST_TOKEN` optional, depending on your ingestion/auth path

The next-generation/test Lambda that should receive this code first is:

```text
customer-simulator-prod-cc-customer-simulator
```

Do not update the live Lambda without an intentional production cutover:

```text
cc-customer-simulator-v2
```

## Chat Behavior

Chat progression is scenario-driven through `simulation.stateModel.chatStepProgression`.

The late delivery chat scenario uses stricter progression gates so the customer does not advance when the learner only says one loose keyword. Key gates require:

- address verification before the customer provides the address
- weather or fulfillment-center explanation plus updated delivery expectation
- 20 percent refund plus both refund destination options
- original payment/card plus refund timing
- delivery recap plus a next step if delivery misses

Scenario-specific customer behavior rules now live in scenario JSON rather than scenario-ID branches in Lambda.

Supported scenario-driven behavior fields include:

- `customer.behavior.rules`
- `customer.behavior.conditionalFollowUps`
- `customer.behavior.softeningRule`
- `customer.behavior.closingRule`
- `customer.behavior.allowedObjections`

Backward-compatible fields such as `facts.conditionalFollowUp`, `facts.allowedObjections`, and `customer.behavior.closingLine` are still supported.

## Voice Behavior

The voice experience keeps the existing Realtime WebRTC flow.

Transcript capture now uses:

- Realtime assistant transcript events for customer turns
- Realtime input audio transcription events for agent turns when available
- `item_id` reconciliation where available
- browser `SpeechRecognition` only as a fallback
- duplicate prevention when Realtime transcription and browser fallback capture the same or very similar agent text

`POST /session` requests OpenAI Realtime input audio transcription:

```json
{
  "audio": {
    "input": {
      "transcription": {
        "model": "gpt-realtime-whisper",
        "language": "en",
        "delay": "medium"
      }
    }
  }
}
```

Server VAD turn detection is still preserved.

## Coaching And Transcripts

`POST /evaluate` returns behavior-framework coaching for the seven official customer care behaviors:

- `issue_understanding`
- `emotional_acknowledgement`
- `problem_ownership`
- `personalization`
- `expectation_setting`
- `pet_engagement`
- `communication_style`

Rating scale:

- `To a Great Extent` = 100
- `To Some Extent` = 50
- `Missed Opportunity` = 0
- `No Opportunity` = excluded from the denominator

`POST /coaching` writes structured DynamoDB records that preserve:

- transcript
- channel
- scenario id and scenario name
- simulation session id
- learner fields
- final score
- focus behavior
- behavior rating, score, summary, score explanation, observed criteria, and missed criteria columns

The code currently saves full transcripts in DynamoDB. Long calls may eventually need S3 transcript storage because DynamoDB items have a 400 KB limit.

## Local Verification

Offline calibration, no AWS or OpenAI calls:

```bash
node tests/calibration/run-calibration.js
```

Optional live calibration against a local or deployed `/evaluate` endpoint:

```bash
EVAL_API_URL="https://example.execute-api.us-east-2.amazonaws.com/evaluate" node tests/calibration/run-calibration.js
```

Behavior framework regression checks:

```bash
node tests/behavior-framework.test.js
```

Known current unrelated failure:

```text
Missing JSON fixture on_time_delivery_no_partial_refund_needed_chat.json
```

The behavior test file passes the current targeted checks before it reaches that missing fixture.

## Manual AWS Deployment Checklist

Code to deploy first to `customer-simulator-prod-cc-customer-simulator`:

- `Lambda.js`

Rise files to upload or paste into the test Rise package:

- `ArticulateRise-ChatExperience.html`
- `ArticulateRise-VoiceExperience.html`

Scenario objects to upload to S3:

- `scenarios/late_delivery_20_partial_refund_chat.json` -> `scenarios/late_delivery_20_partial_refund_chat.json`
- `scenarios/late_delivery_20_partial_refund.scenario.json` -> `scenarios/late_delivery_20_partial_refund.json`

Manual AWS settings to verify:

- Lambda environment variables listed above
- Lambda IAM can read scenario objects from S3
- Lambda IAM can write coaching rows to DynamoDB
- API Gateway routes reach the Lambda
- CORS allows the Rise/LMS origin
- DynamoDB table keys match the existing `RoleplayCoaching` shape
- CloudWatch logs show no `/scenario`, `/session`, `/evaluate`, or `/coaching` errors during smoke tests

Rollback options:

- Point Rise `apiBase` back to the prior backend
- Restore the previous Lambda version/package for the test Lambda
- Restore prior S3 `index.json` and scenario objects
- Do not use `cc-customer-simulator-v2` as a rollback target unless that is part of an intentional production procedure
