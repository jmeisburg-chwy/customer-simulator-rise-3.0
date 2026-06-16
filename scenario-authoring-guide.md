# Scenario Authoring Guide

This guide defines the scenario object used by the current Customer Simulator platform. Author scenarios to this shape so chat and voice frontends can render display content, use chat progression rules, and submit coaching results consistently.

## Runtime Storage

The Rise runtime reads scenarios from the S3 scenario library:

- `index.json` lists available scenarios.
- `scenarios/{normalized_scenario_id}.json` contains one single scenario object.
- Batch files that contain an array of scenarios are not supported at runtime. Split batch outputs into individual scenario files and update `index.json` before using them in Rise.

## Required Fields

These fields should always be present:

- `version`
- `id`
- `label`
- `title`
- `channels`
- `defaultChannel`
- `customer.persona.name`
- `customer.persona.tone`
- `customer.persona.goal`
- `customer.opening`
- `frontend.shared.introInstructions`
- `coaching.qualityChecklist`

Required when `channels` includes `chat`:

- `frontend.chat.guideTitle`
- `frontend.chat.hotkeyProfile`
- `frontend.chat.guideSections`
- `frontend.chat.initialTranscript`
- `simulation.stateModel.chatStepProgression`

Required when `channels` includes `voice`:

- `frontend.voice.guideTopNote`
- `frontend.voice.guideSections`
- `frontend.voice.endNote`

## Optional Fields

- `customer.facts`
- `frontend.chat.systemWalkthrough`
- `frontend.chat.customerDisplayName`
- `frontend.chat.standardText`
- `frontend.voice.learn`
- `frontend.voice.customerDisplayName`
- `coaching.summaryGuidance`

These fields are optional for the schema, but they are strongly recommended because they improve frontend display quality and evaluation clarity.

## Shared Fields

- `version`: Schema version for authoring compatibility. Use a simple string such as `"1.0"`.
- `id`: Stable scenario slug. Use lowercase letters, numbers, and underscores only.
- `label`: Human-readable scenario name used in reporting and selection.
- `title`: Full scenario title.
- `channels`: Array containing `"chat"`, `"voice"`, or both.
- `defaultChannel`: Optional preferred launch channel. Use `"chat"` or `"voice"`. If omitted, the runtime selects the first supported channel and finally falls back to `"chat"`.
- `customer.persona.name`: Primary customer name.
- `customer.persona.tone`: Short description of how the customer should sound or behave.
- `customer.persona.goal`: What the customer wants resolved.
- `customer.opening.chat`: Initial chat opening line.
- `customer.opening.voice`: Initial voice opening line.
- `customer.facts`: Supporting details the scenario may rely on.
- `frontend.shared.introInstructions`: Intro instructions shown before the experience.

## Chat-Only Fields

- `frontend.chat.guideTitle`: Title for the right-side guidance panel.
- `frontend.chat.customerDisplayName`: Name shown in chat metadata. If omitted, the platform can fall back to customer name fields.
- `frontend.chat.hotkeyProfile`: Use `"core"` or `"rx"`.
- `frontend.chat.standardText`: Optional scenario-specific Standard Text set. When present, the chat experience should use these hotkeys instead of the global profile hotkeys.
- `frontend.chat.guideSections`: Guidance sections shown to the learner.
- `frontend.chat.initialTranscript`: Initial chat turn list. The first customer turn should currently use `role: "assistant"` because of the current frontend rendering logic.
- `frontend.chat.systemWalkthrough`: Canonical workflow progression model for Learn, Practice, and Apply reuse. Keep screenshots in `screens[]` and named progression points in `moments[]`.
- `simulation.stateModel.chatStepProgression`: Keyword-based rules used by the current chat simulator to decide whether the learner has progressed.

`frontend.chat.standardText` entries should use this shape:

- `hotkey`: The Standard Text hotkey, such as `"DE6"`.
- `template`: The exact text associated with the hotkey.
- `notes`: Optional authoring or personalization notes for that Standard Text item.

## Voice-Only Fields

- `frontend.voice.guideTopNote`: Short note above the voice guide.
- `frontend.voice.customerDisplayName`: Optional display name for voice-oriented metadata or future display usage.
- `frontend.voice.learn`: Optional Voice Learn demonstration assets. Voice Learn V1 uses authored audio plus canonical chat walkthrough moments; it does not use realtime voice, a microphone, evaluation, or coaching records.
- `frontend.voice.guideSections`: Voice guide sections shown during the call.
- `frontend.voice.endNote`: Short note near the end of the experience.

`frontend.voice.learn` should use this shape:

- `defaultDemoId`: ID of the demonstration to load first.
- `demonstrations[*].id`: Stable demo ID, such as `"modeled-call-v1"`.
- `demonstrations[*].title`: Learner-facing demo title.
- `demonstrations[*].audio.assetKey`: Preferred MP3 asset key for packaged or hosted scenario assets.
- `demonstrations[*].audio.src`: Optional direct URL fallback when an asset key is not resolvable.
- `demonstrations[*].audio.mimeType`: Usually `"audio/mpeg"`.
- `demonstrations[*].audio.durationSeconds`: Optional authoring metadata.
- `demonstrations[*].cuePoints[*].timeSeconds`: Playback time that should activate a workflow moment.
- `demonstrations[*].cuePoints[*].momentId`: Must reference `frontend.chat.systemWalkthrough.moments[*].id`.
- `demonstrations[*].transcript[*]`: Optional transcript rows with `speaker` and `text`.

Do not create a separate voice walkthrough schema. Voice Learn cue points should point to `frontend.chat.systemWalkthrough.moments[]`, and each referenced moment should point to the screen that should appear at that point in the audio.

## Coaching Fields

- `coaching.behaviorRubric`: Required for behavior-framework scoring. Include all seven official behavior keys. For each behavior, define whether the scenario creates an opportunity and what earns `To Some Extent`, `To a Great Extent`, and `Missed Opportunity`.
- `coaching.qualityChecklist`: Categories and behaviors the evaluator should assess.
- `coaching.summaryGuidance`: Optional guidance for how the summary should be written.

## Validation Rules

- Keep the file valid JSON. No comments or trailing commas.
- `id` must be stable and slug-like.
- `channels` must contain only `"chat"` and/or `"voice"`.
- `defaultChannel`, when present, must be `"chat"` or `"voice"`.
- Every string array should contain non-empty strings only.
- `frontend.chat.hotkeyProfile` must be `"core"` or `"rx"`.
- `frontend.chat.standardText[*].hotkey` must be non-empty.
- `frontend.chat.standardText[*].template` must be non-empty.
- `frontend.chat.initialTranscript[*].content` must be non-empty.
- `frontend.chat.initialTranscript[*].role` should currently be `"assistant"` for customer opening turns.
- `frontend.chat.systemWalkthrough.moments[*].id` should be stable because Voice Learn cue points, Practice hints, and future analytics may reference it.
- `frontend.voice.learn.demonstrations[*].cuePoints[*].momentId` should reference an existing canonical walkthrough moment.
- `simulation.stateModel.chatStepProgression[*].match.all` and `.match.any` currently support only:
  - `op: "contains_any"`
  - `phrases: string[]`
- `coaching.behaviorRubric` must include exactly these keys: `issue_understanding`, `emotional_acknowledgement`, `problem_ownership`, `personalization`, `expectation_setting`, `pet_engagement`, and `communication_style`.
- `coaching.behaviorRubric[*].has_opportunity` should be `false` only when the scenario intentionally does not give the learner a fair chance to demonstrate that behavior. A behavior with `has_opportunity: false` should be rated `No Opportunity` and excluded from the score denominator.
- `coaching.behaviorRubric[*].to_some_extent_guidance` should describe real but partial, delayed, generic, inconsistent, or lower-impact performance.
- `coaching.behaviorRubric[*].to_great_extent_guidance` should describe visibly strong performance that would be useful as a positive coaching example.
- `coaching.qualityChecklist[*].behaviors` can still support legacy display and prompt clarity, but behavior-framework scoring should rely on `coaching.behaviorRubric`.

## Practical Authoring Tips

- Write `customer.persona.goal` as the resolution target, not the emotional state.
- Keep guide bullets coachable and behavior-specific. Good bullets describe what the learner should say or do.
- Keep chat progression rules broad enough to recognize natural phrasing. Include synonyms in `phrases`.
- Use `customer.facts` for details authors need to track, but avoid adding extra top-level fields outside the contract.
- Prefer `frontend.chat.standardText` for scenario-specific hotkeys instead of expanding the global Lambda hotkey library for every scenario.
- If a scenario is chat-only, still include `customer.opening.voice` as a placeholder only if your workflow requires it. Otherwise, omit the unused channel block.
- For voice scenarios, write guide copy that supports a spoken flow rather than copy-paste text behavior.
- For Voice Learn, store MP3 files outside the JSON and reference them by `audio.assetKey`; use `audio.src` only as a direct fallback for preview or hosted assets.
- Use the same moment IDs for Chat Learn and Voice Learn whenever both demonstrations represent the same workflow point.
- For behavior scoring, do not write only binary-observable checks. Define the scenario-specific difference between `To Some Extent` and `To a Great Extent` so the evaluator does not invent the bar.
- Use `No Opportunity` intentionally. If a behavior is not relevant to the scenario, mark `has_opportunity: false` rather than making the learner earn or lose points for it.
