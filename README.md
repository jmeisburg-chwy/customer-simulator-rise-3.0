# Customer Simulator

## What this project is

Customer Simulator is a Chewy training tool with one AWS Lambda backend and two separate frontend experiences:

- `ArticulateRise-ChatExperience.html` for chat practice
- `ArticulateRise-VoiceExperience.html` for voice practice

The backend is the source of truth for scenarios, customer behavior, evaluation, and coaching storage.

## How it works at a high level

`Lambda.js` serves scenario configuration to both frontends by reading the selected scenario from the S3 scenario library.

- Chat and voice stay separate in the UI.
- Both frontends load scenario-specific display/config data from `GET /scenario`.
- Chat uses `POST /chat-turn` for turn-by-turn customer replies.
- Voice uses `POST /session` to create an OpenAI Realtime session.
- Both experiences use `POST /evaluate` to generate behavior-framework coaching.
- Both can save coaching records through `POST /coaching`; behavior-framework payloads are stored as one manager-facing session record per learner attempt, with learner/session metadata, overall score fields, coaching summary fields, and flattened per-behavior dashboard columns.

Scenario selection is controlled in each frontend by:
- `SCENARIO_OVERRIDE` if set
- otherwise the `scenarioId` query parameter
- otherwise the frontend default scenario id

## Quick start

1. Deploy `Lambda.js` behind an HTTP endpoint.
2. Set the required Lambda environment variables.
3. Update `SESSION_BASE` in both frontend HTML files.
4. Optionally set `SCENARIO_OVERRIDE` in either frontend.
5. Open or embed the frontend HTML files in Articulate Rise.

For a new scenario:
1. Use the GPT prompt in `gpt-scenario-generation-prompt.md` with the Customer Simulator Scenario Builder.
2. Upload one scenario object to `scenarios/{normalized_scenario_id}.json` in the configured S3 scenario library bucket.
3. Add that scenario to `index.json`.
4. Point the frontend to that scenario with `SCENARIO_OVERRIDE` or `?scenarioId=...`.

## AWS setup

Required Lambda environment variables:

- `OPENAI_API_KEY`
- `COACHING_TABLE`
- `INGEST_TOKEN`
- `AWS_REGION`
- `SCENARIO_LIBRARY_BUCKET`
- `SCENARIO_LIBRARY_PREFIX` (optional)

Required API routes:

- `GET /scenario`
- `GET /scenarios`
- `POST /chat-turn`
- `POST /evaluate`
- `POST /coaching`
- `POST /session`

Practical notes:

- `GET /scenario` is what the frontends use to load scenario-specific guidance and configuration.
- `GET /scenario`, `POST /chat-turn`, `POST /session`, and `POST /evaluate` load only the requested `scenarios/{normalized_scenario_id}.json` object from S3.
- `GET /scenarios` reads `index.json` and is useful for listing available scenarios and voice discovery flows.
- `POST /coaching` writes to DynamoDB using `COACHING_TABLE`. Behavior-framework payloads write one item per completed learner attempt so the DynamoDB to S3 to Snowflake to OmniReach pipeline keeps one dashboard row per learner session.
- Make sure CORS is configured for the domain or LMS origin that will host the HTML files.

## Frontend setup

Key frontend files:

- `ArticulateRise-ChatExperience.html`
- `ArticulateRise-VoiceExperience.html`

For most deployments, the only frontend values you need to change are:

- `SESSION_BASE`
- `SCENARIO_OVERRIDE`

How scenario selection works:

- Leave `SCENARIO_OVERRIDE` blank to use the URL parameter or default scenario.
- Use `?scenarioId=your_scenario_id` when you want the host page to control the scenario.
- Set `SCENARIO_OVERRIDE` when you want a frontend locked to one scenario.

## Creating a new scenario

Use these files:

- `scenario-template.json`
- `scenario-authoring-guide.md`
- `gpt-scenario-generation-prompt.md`

Recommended workflow:

1. Start with the GPT "Customer Simulator Scenario Builder".
2. Have it generate runtime-valid scenario JSON using the current contract.
3. Review the output against `scenario-authoring-guide.md`.
4. Save the final scenario object as `scenarios/{normalized_scenario_id}.json` in the S3 scenario library bucket.
5. Add or update the corresponding entry in `index.json`.
6. Test the scenario in chat and/or voice depending on the channels you enabled.

Important:

- The S3 scenario library is the backend source of truth for scenarios.
- Runtime scenario files must be single scenario objects. Batch array files are not supported by the Rise runtime; split batches into individual scenario files before upload.
- Do not create new scenarios only in the frontend.
- The frontend should consume scenario data from `/scenario`, not hardcoded scenario copy whenever backend config is available.

## Architecture overview

Key files:

- `Lambda.js`
  Backend routes, S3 scenario loading, prompt construction, evaluation, and coaching persistence.
- `ArticulateRise-ChatExperience.html`
  Standalone chat experience for Rise or browser embedding.
- `ArticulateRise-VoiceExperience.html`
  Standalone voice experience using Realtime session creation.
- `scenario-template.json`
  Starter template for new scenarios.
- `scenario-authoring-guide.md`
  Field-by-field scenario authoring guide.
- `gpt-scenario-generation-prompt.md`
  Prompt for the GPT-based scenario builder.

High-level flow:

1. Frontend resolves the active scenario id.
2. Frontend requests scenario config from `GET /scenario`.
3. Learner completes chat or voice interaction.
4. Backend evaluates the transcript with `POST /evaluate`.
5. Frontend optionally saves the coaching record with `POST /coaching`.

## Behavior framework scoring

The evaluator returns all seven default Customer Care behaviors:

- `issue_understanding`
- `emotional_acknowledgement`
- `problem_ownership`
- `personalization`
- `expectation_setting`
- `pet_engagement`
- `communication_style`

Ratings use the official behavior framework scale:

- `To a Great Extent` = `100/1`
- `To Some Extent` = `50/1`
- `Missed Opportunity` = `0/1`
- `No Opportunity` = `0/0`

`No Opportunity` is applicability, not a penalty. It is excluded from the final score denominator. Scenario authors should define `coaching.behaviorRubric` so each scenario controls what creates an opportunity and what partial versus full credit looks like.

## Coaching reporting fields

Behavior-framework coaching saves a lean DynamoDB row optimized for training-manager dashboards:

- Learner/session fields: `learner_id`, `learner_name`, `learner_first_name`, `learner_last_name`, `simulation_session_id`, `scenario_id`, `scenario_name`, `channel`, `completed_at`, `trainingDate`, `trainingTime`, `completionStatus`.
- DynamoDB technical key fields: `agentId`, `endedAt_sessionId`. These remain because the existing `RoleplayCoaching` table requires them as primary key attributes.
- Overall coaching fields: `final_score`, `focus_behavior`, `coachSummaryText`, `what_went_well`, `what_to_strengthen_next`.
- Per-behavior fields for each official behavior: `{behavior}_rating`, `{behavior}_score`, `{behavior}_summary`, `{behavior}_score_explanation`, `{behavior}_observed_criteria`, `{behavior}_missed_criteria`.

The behavior-framework row intentionally omits redundant, empty, or internal fields such as `agentName`, `learner_employee_id`, `learner_email`, `learner_username`, `learner_identity_source`, `record_type`, `course_id`, nested `behavior_results`, and full `transcript`.

## Notes / important behaviors

- Chat and voice are separate experiences and can point to different scenarios.
- Cleaned scenarios in S3 use the current runtime contract. Older scenarios may still be using compatibility paths until they are refactored.
- Generated scenario JSON should be uploaded as one object per scenario to the S3 scenario library.
- `simulation.stateModel.chatStepProgression` is the source of truth for chat progression in cleaned scenarios.
- Because prompt behavior lives in scenario data and backend logic, small wording changes can change learner experience.
- There is no full automated test suite here yet, so test changes end to end after updating scenarios, prompts, or frontend config.
