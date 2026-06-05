# Calibration Tests

Calibration fixtures are trainer-scored transcripts used to compare expected human coaching ratings against AI coaching output.

## Offline Command

Run the default offline validation:

```bash
node tests/calibration/run-calibration.js
```

Offline mode does not call OpenAI, AWS, or any deployed endpoint. It validates fixture shape, checks that all seven behavior ratings are present, calculates the trainer expected final score, and prints a summary table.

## Optional Live Mode

To compare against a local or deployed `/evaluate` endpoint:

```bash
EVAL_API_URL="https://example.execute-api.us-east-2.amazonaws.com/evaluate" node tests/calibration/run-calibration.js
```

Optional score tolerance defaults to 10 points:

```bash
CALIBRATION_SCORE_TOLERANCE=5 EVAL_API_URL="http://localhost:3000/evaluate" node tests/calibration/run-calibration.js
```

Live mode reports exact rating matches, mismatches, final score difference, and pass/fail based on the score tolerance.

## Adding Fixtures

Add one JSON file under `tests/calibration/fixtures/<scenario_id>/`.

Required fields:

- `id`
- `scenario_id`
- `channel`: `chat` or `voice`
- `transcript`
- `expected_behavior_ratings`
- `trainer_notes`

`expected_behavior_ratings` must include every official behavior:

- `issue_understanding`
- `emotional_acknowledgement`
- `problem_ownership`
- `personalization`
- `expectation_setting`
- `pet_engagement`
- `communication_style`

Allowed ratings:

- `To a Great Extent`
- `To Some Extent`
- `Missed Opportunity`
- `No Opportunity`

Use `trainer_notes` to explain why the score is expected. These notes are for calibration review and should be specific enough for another trainer to understand the scoring decision.

## Smoke-Test Fixtures

The `chat_smoke_2026_06_05.json` fixture captures the reviewed chat smoke test transcript and expected 100% behavior ratings.

The `voice_smoke_2026_06_05.json` fixture captures the reviewed voice smoke test scoring pattern from the coaching report. Its JSON includes a `source_note` because the raw voice transcript was not exported with the attachment; replace it with the raw transcript when one is available.
