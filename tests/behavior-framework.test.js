const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const {
  ratingToScore,
  normalizeBehaviorResults,
  buildCoachingDynamoItems,
  selectFocusBehavior,
  shouldRetryOpenAIRequest,
  normalizeUploadedScenario,
  normalizeChatStepProgression,
  buildScenarioClientConfig,
  buildRealtimeInstructions,
  buildChatInstructions,
  inferChatStepPassed,
  resolveChatCustomerMessage,
  getScenario
} = require(path.join(repoRoot, "Lambda.js")).__test;

const HOSTED_COACH_CHEWY_URL = "https://pub-f427f39912f4461691149d76a2e41031.r2.dev/Coach_Chewy_Circle_large.png";
const HOSTED_COACH_CHEWY_RE = new RegExp(HOSTED_COACH_CHEWY_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const LATE_DELIVERY_SCENARIO_ID = "late_delivery_20_partial_refund";
const LATE_DELIVERY_CHAT_SCENARIO_ID = "late_delivery_20_partial_refund_chat";
const DEFAULT_API_BASE = "https://1icxzv8avg.execute-api.us-east-2.amazonaws.com";
const REQUIRED_SCENARIO_MESSAGE =
  "Scenario unavailable: scenarioId is required. Provide ?scenarioId=..., window.CCS_CONFIG.scenarioId, or set SCENARIO_OVERRIDE for a locked package.";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      throw error;
    }
  }
}

function readJsonFixture(filename) {
  const candidates = [
    path.join("/Users/jmeisburg/Downloads", filename),
    path.join("/Users/jmeisburg/Downloads/RRC", filename),
    path.join("/Users/jmeisburg/Downloads/scenario-1", filename),
    path.join(repoRoot, "fixtures", filename)
  ];
  const fixturePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!fixturePath) {
    throw new Error(`Missing JSON fixture ${filename}; checked ${candidates.join(", ")}`);
  }
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

test("maps official behavior ratings to score numerator and denominator", () => {
  assert.deepStrictEqual(ratingToScore("To a Great Extent"), { score_numerator: 100, score_denominator: 1 });
  assert.deepStrictEqual(ratingToScore("To Some Extent"), { score_numerator: 50, score_denominator: 1 });
  assert.deepStrictEqual(ratingToScore("Missed Opportunity"), { score_numerator: 0, score_denominator: 1 });
  assert.deepStrictEqual(ratingToScore("No Opportunity"), { score_numerator: 0, score_denominator: 0 });
});

test("normalizes behavior results to the official seven behavior rows and excludes No Opportunity from score", () => {
  const result = normalizeBehaviorResults([
    {
      behavior_name: "issue_understanding",
      rating: "To a Great Extent",
      evidence_turn_id: 1,
      score_explanation: "The response confirmed the late order, verified the address, and connected the issue to Fluffy's cat litter.",
      criteria_results: [
        { label: "Confirmed the late delivery issue", observed: true, rationale: "The learner identified the missing order." },
        { label: "Referenced Fluffy's cat litter", observed: true, rationale: "The learner used the pet and product context." },
        { label: "Verified the shipping address", observed: false, rationale: "The learner did not confirm the full address." }
      ]
    },
    { behavior_name: "emotional_acknowledgement", rating: "To Some Extent", evidence_turn_id: 2 },
    { behavior_name: "pet_engagement", rating: "No Opportunity" }
  ], "Agent: hello\nCustomer: worried");

  assert.strictEqual(result.behaviors.length, 7);
  assert.strictEqual(result.total_score_numerator, 150);
  assert.strictEqual(result.total_score_denominator, 2);
  assert.strictEqual(result.final_score, 75);
  assert.strictEqual(result.behaviors.find((item) => item.behavior_name === "pet_engagement").score_denominator, 0);

  const issueUnderstanding = result.behaviors.find((item) => item.behavior_name === "issue_understanding");
  assert.strictEqual(issueUnderstanding.score_explanation, "The response confirmed the late order, verified the address, and connected the issue to Fluffy's cat litter.");
  assert.deepStrictEqual(issueUnderstanding.criteria_results, [
    { label: "Confirmed the late delivery issue", observed: true, rationale: "The learner identified the missing order." },
    { label: "Referenced Fluffy's cat litter", observed: true, rationale: "The learner used the pet and product context." },
    { label: "Verified the shipping address", observed: false, rationale: "The learner did not confirm the full address." }
  ]);
});

test("downgrades partial credit when no criteria were observed", () => {
  const result = normalizeBehaviorResults([
    {
      behavior_name: "personalization",
      rating: "To Some Extent",
      evidence_turn_id: 4,
      score_explanation: "You collected basic details, but did not use the available personal context.",
      criteria_results: [
        { label: "Used customer name naturally", observed: false, rationale: "The learner did not use the customer's name." },
        { label: "Referenced Fluffy or the cat litter", observed: false, rationale: "The learner did not use the pet or item context." },
        { label: "Offered tailored options", observed: false, rationale: "The learner did not tailor the resolution." }
      ]
    }
  ], "Agent: It looks delayed.");

  const personalization = result.behaviors.find((item) => item.behavior_name === "personalization");
  assert.strictEqual(personalization.rating, "Missed Opportunity");
  assert.strictEqual(personalization.score_numerator, 0);
  assert.strictEqual(personalization.score_denominator, 1);
  assert.strictEqual(result.final_score, 0);
});

test("builds one dashboard-friendly session item for DynamoDB reporting", () => {
  const behaviorResults = [
    {
      behavior_name: "issue_understanding",
      rating: "To a Great Extent",
      evidence_turn_id: 1,
      evidence_time_offset_seconds: 12,
      evidence_text: "I can help with Fluffy's late litter order.",
      transcript_excerpt: "[Turn 1] Agent: I can help with Fluffy's late litter order.",
      behavior_summary: "The learner connected the late delivery issue to the pet and product.",
      score_explanation: "You earned full credit because you clearly identified the issue and tied it to the customer context.",
      criteria_results: [
        { label: "Confirmed the late delivery", observed: true, rationale: "The learner named the late order." },
        { label: "Used pet context", observed: true, rationale: "The learner mentioned Fluffy." },
        { label: "Verified the product", observed: true, rationale: "The learner referenced litter." }
      ]
    },
    {
      behavior_name: "emotional_acknowledgement",
      rating: "To Some Extent",
      evidence_turn_id: 2,
      evidence_text: "I know that is frustrating.",
      transcript_excerpt: "[Turn 2] Agent: I know that is frustrating.",
      behavior_summary: "The learner acknowledged frustration but did not make the empathy highly specific.",
      score_explanation: "You earned partial credit because you acknowledged emotion in a general way.",
      criteria_results: [
        { label: "Acknowledged emotion", observed: true, rationale: "The learner named frustration." },
        { label: "Connected emotion to the situation", observed: false, rationale: "The acknowledgement was brief." },
        { label: "Maintained a supportive tone", observed: true, rationale: "The language was calm." }
      ]
    },
    {
      behavior_name: "problem_ownership",
      rating: "Missed Opportunity",
      evidence_turn_id: 3,
      evidence_text: "You can check tracking later.",
      transcript_excerpt: "[Turn 3] Agent: You can check tracking later.",
      behavior_summary: "The learner did not take clear ownership of the next step.",
      score_explanation: "You did not earn credit because you shifted the work back to the customer.",
      criteria_results: [
        { label: "Took ownership", observed: false, rationale: "The learner did not offer to handle it." },
        { label: "Narrated action", observed: false, rationale: "No action was described." },
        { label: "Followed through", observed: false, rationale: "No follow-through was offered." }
      ]
    },
    {
      behavior_name: "personalization",
      rating: "To Some Extent",
      evidence_turn_id: 4,
      evidence_text: "I see this is for Fluffy.",
      transcript_excerpt: "[Turn 4] Agent: I see this is for Fluffy.",
      behavior_summary: "The learner used one personal detail from the scenario.",
      score_explanation: "You earned partial credit because you personalized with the pet name once.",
      criteria_results: [
        { label: "Used pet name", observed: true, rationale: "The learner mentioned Fluffy." },
        { label: "Used order detail", observed: false, rationale: "The learner did not mention the litter later." },
        { label: "Made personalization natural", observed: true, rationale: "The wording fit the conversation." }
      ]
    },
    {
      behavior_name: "expectation_setting",
      rating: "To a Great Extent",
      evidence_turn_id: 5,
      evidence_text: "The replacement should arrive tomorrow, and I will send the confirmation now.",
      transcript_excerpt: "[Turn 5] Agent: The replacement should arrive tomorrow, and I will send the confirmation now.",
      behavior_summary: "The learner gave a specific timeline and customer-visible follow-through.",
      score_explanation: "You earned full credit because you set a clear expectation and explained the next step.",
      criteria_results: [
        { label: "Provided timeline", observed: true, rationale: "The learner said tomorrow." },
        { label: "Explained next step", observed: true, rationale: "The learner said they would send confirmation." },
        { label: "Made the outcome visible", observed: true, rationale: "The customer knows what to expect." }
      ]
    },
    {
      behavior_name: "pet_engagement",
      rating: "No Opportunity",
      evidence_turn_id: null,
      evidence_text: "",
      transcript_excerpt: "",
      behavior_summary: "",
      score_explanation: "This behavior did not affect the score because there was no clear opportunity.",
      criteria_results: [
        { label: "Had pet conversation opportunity", observed: false, rationale: "The contact stayed operational." },
        { label: "Used pet-centered relevance", observed: false, rationale: "No additional opportunity appeared." },
        { label: "Kept pet discussion concise", observed: false, rationale: "Not applicable." }
      ]
    },
    {
      behavior_name: "communication_style",
      rating: "To a Great Extent",
      evidence_turn_id: 6,
      evidence_text: "I have that taken care of for you.",
      transcript_excerpt: "[Turn 6] Agent: I have that taken care of for you.",
      behavior_summary: "The learner was clear, steady, and concise.",
      score_explanation: "You earned full credit because your wording was clear and confident.",
      criteria_results: [
        { label: "Used clear wording", observed: true, rationale: "The learner's response was easy to follow." },
        { label: "Stayed concise", observed: true, rationale: "The learner avoided unnecessary detail." },
        { label: "Maintained confidence", observed: true, rationale: "The learner used assured language." }
      ]
    }
  ];

  const items = buildCoachingDynamoItems({
    simulation_session_id: "session-1",
    learner_id: "12345",
    learner_employee_id: "12345",
    learner_name: "Jane Learner",
    learner_first_name: "Jane",
    learner_last_name: "Learner",
    learner_username: "jlearner",
    learner_email: "jane.learner@example.com",
    course_id: "course-1",
    scenario_id: "scenario-1",
    scenario_name: "Late Delivery",
    channel: "chat",
    completed_at: "2026-05-13T12:00:00.000Z",
    created_at: "2026-05-13T11:59:00.000Z",
    completionStatus: "Completed",
    transcript: "Agent: I can help with Fluffy's late litter order.\\nCustomer: Thank you for checking.",
    coachSummaryText: "You handled the late delivery with clear ownership and helpful next steps.",
    what_went_well: "You identified the delivery problem and gave a clear replacement timeline.",
    what_to_strengthen_next: "Keep making empathy specific to the customer's situation.",
    what_went_well_points: ["Confirmed the late delivery", "Set a clear timeline"],
    what_to_strengthen_next_points: ["Use more specific empathy", "Avoid shifting action back to the customer"],
    behavior_results: behaviorResults
  });

  const expectedSharedColumns = {
    agentId: "12345",
    endedAt_sessionId: "2026-05-13T12:00:00.000Z#session-1",
    learner_id: "12345",
    learner_name: "Jane Learner",
    learner_first_name: "Jane",
    learner_last_name: "Learner",
    simulation_session_id: "session-1",
    scenario_id: "scenario-1",
    scenario_name: "Late Delivery",
    channel: "chat",
    completed_at: "2026-05-13T12:00:00.000Z",
    trainingDate: "05/13/2026",
    completionStatus: "Completed"
  };

  assert.strictEqual(items.length, 1);
  const item = items[0];
  for (const [key, value] of Object.entries(expectedSharedColumns)) {
    assert.strictEqual(item[key], value, `session ${key}`);
  }
  assert.ok(item.trainingTime);
  assert.strictEqual(item.learner_employee_id, "12345");
  assert.strictEqual(item.learner_username, "jlearner");
  assert.strictEqual(item.learner_email, "jane.learner@example.com");
  assert.strictEqual(item.learner_identity_source, "");
  assert.strictEqual(item.transcript, "Agent: I can help with Fluffy's late litter order.\nCustomer: Thank you for checking.");
  assert.strictEqual(item.coachSummaryText, "You handled the late delivery with clear ownership and helpful next steps.");
  assert.strictEqual(item.what_went_well, "You identified the delivery problem and gave a clear replacement timeline.");
  assert.strictEqual(item.what_to_strengthen_next, "Keep making empathy specific to the customer's situation.");
  assert.strictEqual(item.final_score, 66.7);
  assert.strictEqual(item.focus_behavior, "problem_ownership");
  assert.ok(!Object.hasOwn(item, "agentName"));
  assert.ok(!Object.hasOwn(item, "record_type"));
  assert.ok(!Object.hasOwn(item, "scenarioLabel"));
  assert.ok(!Object.hasOwn(item, "course_id"));
  assert.ok(!Object.hasOwn(item, "created_at"));
  assert.ok(!Object.hasOwn(item, "total_score_numerator"));
  assert.ok(!Object.hasOwn(item, "total_score_denominator"));
  assert.ok(!Object.hasOwn(item, "strongest_behaviors"));
  assert.ok(!Object.hasOwn(item, "behavior_results"));
  assert.ok(!Object.hasOwn(item, "what_went_well_points"));
  assert.ok(!Object.hasOwn(item, "what_to_strengthen_next_points"));
  assert.ok(!Object.hasOwn(item, "behaviors"));
  assert.ok(!Object.hasOwn(item, "observedBehaviors"));
  assert.ok(!Object.hasOwn(item, "missedBehaviors"));

  assert.strictEqual(item.issue_understanding_rating, "To a Great Extent");
  assert.strictEqual(item.issue_understanding_score, 100);
  assert.strictEqual(item.issue_understanding_summary, "The learner connected the late delivery issue to the pet and product.");
  assert.strictEqual(item.issue_understanding_score_explanation, "You earned full credit because you clearly identified the issue and tied it to the customer context.");
  assert.strictEqual(item.issue_understanding_observed_criteria, "Confirmed the late delivery; Used pet context; Verified the product");
  assert.strictEqual(item.issue_understanding_missed_criteria, "");
  assert.ok(!Object.hasOwn(item, "issue_understanding_criteria_detail"));
  assert.strictEqual(item.problem_ownership_rating, "Missed Opportunity");
  assert.strictEqual(item.problem_ownership_score, 0);
  assert.strictEqual(item.problem_ownership_observed_criteria, "");
  assert.strictEqual(item.problem_ownership_missed_criteria, "Took ownership; Narrated action; Followed through");
  assert.ok(!Object.hasOwn(item, "problem_ownership_criteria_detail"));
  assert.strictEqual(item.pet_engagement_rating, "No Opportunity");
  assert.strictEqual(item.pet_engagement_score, null);
});

test("selects the lowest scoring behavior with opportunity as the learner focus", () => {
  const focus = selectFocusBehavior([
    { behavior_name: "issue_understanding", rating: "To Some Extent", score_numerator: 50, score_denominator: 1 },
    { behavior_name: "problem_ownership", rating: "Missed Opportunity", score_numerator: 0, score_denominator: 1 },
    { behavior_name: "pet_engagement", rating: "No Opportunity", score_numerator: 0, score_denominator: 0 }
  ]);

  assert.strictEqual(focus.behavior_name, "problem_ownership");
});

test("does not select a focus behavior when every applicable behavior is fully demonstrated", () => {
  const focus = selectFocusBehavior([
    { behavior_name: "issue_understanding", rating: "To a Great Extent", score_numerator: 100, score_denominator: 1 },
    { behavior_name: "emotional_acknowledgement", rating: "To a Great Extent", score_numerator: 100, score_denominator: 1 },
    { behavior_name: "problem_ownership", rating: "To a Great Extent", score_numerator: 100, score_denominator: 1 },
    { behavior_name: "personalization", rating: "To a Great Extent", score_numerator: 100, score_denominator: 1 },
    { behavior_name: "expectation_setting", rating: "To a Great Extent", score_numerator: 100, score_denominator: 1 },
    { behavior_name: "pet_engagement", rating: "To a Great Extent", score_numerator: 100, score_denominator: 1 },
    { behavior_name: "communication_style", rating: "To a Great Extent", score_numerator: 100, score_denominator: 1 }
  ]);

  assert.strictEqual(focus, null);
});

test("retries only transient OpenAI chat-turn failures", () => {
  assert.strictEqual(shouldRetryOpenAIRequest({ status: 429 }), true);
  assert.strictEqual(shouldRetryOpenAIRequest({ status: 500 }), true);
  assert.strictEqual(shouldRetryOpenAIRequest({ status: 503 }), true);
  assert.strictEqual(shouldRetryOpenAIRequest({ error: Object.assign(new Error("aborted"), { name: "AbortError" }) }), true);
  assert.strictEqual(shouldRetryOpenAIRequest({ status: 400 }), false);
  assert.strictEqual(shouldRetryOpenAIRequest({ status: 401 }), false);
});

test("voice coaching report uses the updated learner-facing report layout", () => {
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(voiceHtml, /Customer Care Behaviors/);
  assert.match(voiceHtml, /View details/);
  assert.match(voiceHtml, /DOING WELL/);
  assert.match(voiceHtml, /OPPORTUNITY/);
  assert.match(voiceHtml, HOSTED_COACH_CHEWY_RE);
  assert.doesNotMatch(voiceHtml, /Here's what I noticed/);
  assert.doesNotMatch(voiceHtml, /Behavior snapshot/);
  assert.doesNotMatch(voiceHtml, /Overall summary/);
  assert.doesNotMatch(voiceHtml, /openAttr/);
  assert.doesNotMatch(voiceHtml, /<details class="behavior-row"\$\{openAttr\}/);
});

test("voice experience tells learners to begin with their Chewy greeting", () => {
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(voiceHtml, /Begin (?:the call )?by (?:stating|speaking) your <strong>Chewy greeting<\/strong>/);
  assert.match(voiceHtml, /class="call-start-callout"/);
});

test("chat coaching report uses the updated learner-facing report layout", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");

  assert.match(chatHtml, /Customer Care Behaviors/);
  assert.match(chatHtml, /View details/);
  assert.match(chatHtml, /DOING WELL/);
  assert.match(chatHtml, /OPPORTUNITY/);
  assert.match(chatHtml, HOSTED_COACH_CHEWY_RE);
  assert.doesNotMatch(chatHtml, /Here's what I noticed/);
  assert.doesNotMatch(chatHtml, /Behavior snapshot/);
  assert.doesNotMatch(chatHtml, /Overall summary/);
  assert.doesNotMatch(chatHtml, /data:image\/png;base64/);
  assert.doesNotMatch(chatHtml, /item\.open\s*=\s*!!isFocus/);
});

test("chat and voice require an explicit scenario id instead of using baked-in scenario fallbacks", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(chatHtml, /const SCENARIO_OVERRIDE = ""/);
  assert.match(voiceHtml, /const SCENARIO_OVERRIDE = ""/);
  assert.doesNotMatch(chatHtml, /DEFAULT_SCENARIO_ID/);
  assert.doesNotMatch(voiceHtml, /DEFAULT_SCENARIO_ID/);
  assert.match(chatHtml, /const STATIC_CHAT_INSTRUCTIONS = \[/);
  assert.match(chatHtml, new RegExp(REQUIRED_SCENARIO_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(voiceHtml, new RegExp(REQUIRED_SCENARIO_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("chat experience supports configurable apiBase", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");

  assert.match(chatHtml, new RegExp(`const DEFAULT_API_BASE = "${DEFAULT_API_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(chatHtml, /new URLSearchParams\(window\.location\.search\)\.get\("apiBase"\)/);
  assert.match(chatHtml, /getRuntimeConfigValue\("apiBase"\)/);
  assert.match(chatHtml, /const SESSION_BASE = resolveApiBase\(\)/);
});

test("voice experience supports configurable apiBase", () => {
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(voiceHtml, new RegExp(`const DEFAULT_API_BASE = "${DEFAULT_API_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(voiceHtml, /new URLSearchParams\(window\.location\.search\)\.get\("apiBase"\)/);
  assert.match(voiceHtml, /getRuntimeConfigValue\("apiBase"\)/);
  assert.match(voiceHtml, /const SESSION_BASE = resolveApiBase\(\)/);
});

test("chat experience supports configurable scenarioId and fails clearly when missing", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const queryIndex = chatHtml.indexOf('get("scenarioId")');
  const configIndex = chatHtml.indexOf('getRuntimeConfigValue("scenarioId")');
  const overrideIndex = chatHtml.indexOf("String(SCENARIO_OVERRIDE");
  const initializeIndex = chatHtml.indexOf("async function initializeChatExperience()");
  const missingIndex = chatHtml.indexOf("if (!SCENARIO_ID)", initializeIndex);
  const loadIndex = chatHtml.indexOf("loadScenarioDisplayConfig()", initializeIndex);

  assert.ok(queryIndex > -1, "chat query scenarioId lookup missing");
  assert.ok(configIndex > queryIndex, "chat config scenarioId should be checked after query scenarioId");
  assert.ok(overrideIndex > configIndex, "chat SCENARIO_OVERRIDE should be checked after window config scenarioId");
  assert.ok(missingIndex > -1 && missingIndex < loadIndex, "chat missing scenario guard should run before scenario loading");
  assert.match(chatHtml, /renderScenarioUnavailable\(MISSING_SCENARIO_ID_MESSAGE\)/);
});

test("voice experience supports configurable scenarioId and fails clearly when missing", () => {
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");
  const queryIndex = voiceHtml.indexOf('get("scenarioId")');
  const configIndex = voiceHtml.indexOf('getRuntimeConfigValue("scenarioId")');
  const overrideIndex = voiceHtml.indexOf("String(SCENARIO_OVERRIDE");
  const missingIndex = voiceHtml.indexOf("if (!ACTIVE_SCENARIO_ID)");
  const loadIndex = voiceHtml.indexOf("fetchJSON(SCENARIOS_URL");

  assert.ok(queryIndex > -1, "voice query scenarioId lookup missing");
  assert.ok(configIndex > queryIndex, "voice config scenarioId should be checked after query scenarioId");
  assert.ok(overrideIndex > configIndex, "voice SCENARIO_OVERRIDE should be checked after window config scenarioId");
  assert.ok(missingIndex > -1 && missingIndex < loadIndex, "voice missing scenario guard should run before scenario loading");
  assert.match(voiceHtml, /renderScenarioUnavailable\(MISSING_SCENARIO_ID_MESSAGE\)/);
});

test("voice transcript turns are structured and normalized before evaluation", () => {
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(voiceHtml, /function normalizeTranscriptText\(text\)/);
  assert.match(voiceHtml, /function addTurn\(speaker, text, options = \{\}\)/);
  assert.match(voiceHtml, /speaker: resolvedSpeaker/);
  assert.match(voiceHtml, /text: t/);
  assert.match(voiceHtml, /timestamp/);
  assert.match(voiceHtml, /source/);
  assert.match(voiceHtml, /item_id: itemId/);
  assert.match(voiceHtml, /function joinTurnsToTranscriptText\(turns\)/);
  assert.match(voiceHtml, /sort\(\(a, b\) => String\(a\.timestamp \|\| ""\)\.localeCompare\(String\(b\.timestamp \|\| ""\)\)\)/);
  assert.match(voiceHtml, /turn\.speaker === "agent" \? "Agent" : "Customer"/);
});

test("voice transcript capture uses Realtime input transcription with browser speech as deduped fallback", () => {
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(voiceHtml, /conversation\.item\.input_audio_transcription\.delta/);
  assert.match(voiceHtml, /conversation\.item\.input_audio_transcription\.completed/);
  assert.match(voiceHtml, /"realtime_input_audio_transcription"/);
  assert.match(voiceHtml, /"browser_speech_recognition"/);
  assert.match(voiceHtml, /function isDuplicateTranscriptTurn\(speaker, text, source, itemId\)/);
  assert.match(voiceHtml, /function isSimilarTranscriptText\(left, right\)/);
  assert.match(voiceHtml, /if \(source === "realtime_input_audio_transcription"\)/);
  assert.match(voiceHtml, /turn\.source === "browser_speech_recognition"/);
  assert.match(voiceHtml, /if \(isDuplicateTranscriptTurn\(resolvedSpeaker, t, source, itemId\)\) return;/);
});

test("voice customer transcripts are captured from Realtime assistant transcript events by item id", () => {
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(voiceHtml, /const realtimeTranscriptBuffers = \{/);
  assert.match(voiceHtml, /assistant: new Map\(\)/);
  assert.match(voiceHtml, /function getRealtimeItemId\(msg\)/);
  assert.match(voiceHtml, /function appendRealtimeTranscriptDelta\(speaker, msg, source\)/);
  assert.match(voiceHtml, /function completeRealtimeTranscript\(speaker, msg, source\)/);
  assert.match(voiceHtml, /"realtime_assistant_transcript"/);
  assert.match(voiceHtml, /addTurn\(speaker, text, \{ source, item_id: itemId \}\)/);
});

test("chat and voice structured coaching payloads include transcripts", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");
  const chatReportingBlock = chatHtml.match(/function buildReportingPayload\(evaluation, errorText = ""\) \{[\s\S]*?async function fetchJSON/);
  const voiceReportingBlock = voiceHtml.match(/function buildReportingPayload\(evaluation, transcriptText, scenarioId, scenarioLabel, endedAt, errorText = ""\) \{[\s\S]*?async function saveCoachingRecord/);

  assert.ok(chatReportingBlock, "chat buildReportingPayload block not found");
  assert.ok(voiceReportingBlock, "voice buildReportingPayload block not found");
  assert.match(chatReportingBlock[0], /behavior_results: normalizedBehaviorResults\.behaviors/);
  assert.match(chatReportingBlock[0], /transcript: transcriptToEvalText\(\)/);
  assert.match(voiceReportingBlock[0], /behavior_results: normalizedBehaviorResults\.behaviors/);
  assert.match(voiceReportingBlock[0], /transcript: String\(transcriptText \|\| ""\)\.replace/);
});

test("rise frontends do not require platform-only scripts or local platform assets", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  for (const html of [chatHtml, voiceHtml]) {
    assert.doesNotMatch(html, /assets\/auth-api\.js/);
    assert.doesNotMatch(html, /assets\/customer-care-behaviors\.js/);
    assert.doesNotMatch(html, /ChewyAuth/);
    assert.doesNotMatch(html, /managerPreview/);
    assert.doesNotMatch(html, /manager-annotate/);
  }
});

test("rise frontends do not silently render generic scenario fallback content", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(chatHtml, /Scenario unavailable/);
  assert.match(voiceHtml, /Scenario unavailable/);
  assert.doesNotMatch(chatHtml, /Hi\. I’m reaching out because I need help with an order/);
  assert.doesNotMatch(chatHtml, /Verify Details and Explain What You Are Checking/);
  assert.doesNotMatch(voiceHtml, /Open the Call with Confidence/);
  assert.doesNotMatch(voiceHtml, /The customer is calling with a question or concern/);
});

test("chat and voice behavior detail panels use checklist coaching instead of duplicate summary or transcript quote sections", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  for (const html of [chatHtml, voiceHtml]) {
    assert.match(html, /criteria_results/);
    assert.match(html, /What supported this rating/);
    assert.match(html, /These criteria explain what supported your rating/);
    assert.match(html, /not a point-by-point formula/);
    assert.match(html, /Criteria demonstrated/);
    assert.match(html, /Criteria to strengthen/);
    assert.match(html, /criteria-check/);
    assert.match(html, /criteria-miss/);
    assert.match(html, /Coaching Tip/);
    assert.doesNotMatch(html, /Why you got this score/);
    assert.doesNotMatch(html, /behavior-detail-note"><strong>DOING WELL<\/strong>/);
    assert.doesNotMatch(html, /behavior-detail-note"><strong>OPPORTUNITY<\/strong>/);
    assert.doesNotMatch(html, /behaviorOpportunityText/);
    assert.doesNotMatch(html, /behaviorDoingWellText/);
  }
});

test("chat and voice only show behavior coaching tips when there is something to improve", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  for (const html of [chatHtml, voiceHtml]) {
    assert.match(html, /function shouldShowCriteriaTip\(behavior\)/);
    assert.match(html, /function renderCriteriaTip\(behavior\)/);
    assert.match(html, /renderCriteriaTip\(behavior\)/);
    assert.match(html, /To strengthen this behavior, focus on the missed criteria/);
    assert.doesNotMatch(html, /To move this behavior higher, demonstrate every missed item above/);
    assert.doesNotMatch(
      html,
      /<div class="criteria-list">[^`]+<\/div>\s*(?:html \+= `)?<div class="criteria-tip"><strong>Coaching Tip<\/strong>/
    );
  }
});

test("chat fallback feedback cannot render the old quality checklist report", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");

  assert.doesNotMatch(chatHtml, /category: "Acknowledgement"/);
  assert.doesNotMatch(chatHtml, /category: "Trust & Confidence"/);
  assert.doesNotMatch(chatHtml, /const checklist = Array\.isArray\(evaluation\?\.quality_checklist\)/);
  assert.doesNotMatch(chatHtml, /heading\.className = "feedback-card-title"/);
  assert.match(chatHtml, /coerceLegacyEvaluationToBehaviorResults/);
});

test("chat coaching report defines the coach image used by the new report", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");

  assert.match(chatHtml, /const COACH_CHEWY_IMAGE_SRC = "https:\/\/pub-f427f39912f4461691149d76a2e41031\.r2\.dev\/Coach_Chewy_Circle_large\.png";/);
  assert.match(chatHtml, /<img src="\$\{COACH_CHEWY_IMAGE_SRC\}" alt="" \/>/);
});

test("lambda evaluation schema asks for checklist criteria and richer summary points", () => {
  const lambda = fs.readFileSync(path.join(repoRoot, "Lambda.js"), "utf8");

  assert.match(lambda, /score_explanation/);
  assert.match(lambda, /criteria_results/);
  assert.match(lambda, /what_went_well_points/);
  assert.match(lambda, /what_to_strengthen_next_points/);
  assert.match(lambda, /observed/);
  assert.match(lambda, /rationale/);
});

test("lambda realtime session requests input audio transcription for voice agent turns", () => {
  const lambda = fs.readFileSync(path.join(repoRoot, "Lambda.js"), "utf8");

  assert.match(lambda, /input:\s*\{[\s\S]*turn_detection:\s*REALTIME_TURN_DETECTION/);
  assert.match(lambda, /transcription:\s*\{/);
  assert.match(lambda, /model:\s*"gpt-realtime-whisper"/);
  assert.match(lambda, /language:\s*"en"/);
  assert.match(lambda, /delay:\s*"medium"/);
});

test("sample scenario JSON is a single scenario object and normalizes successfully", () => {
  const scenario = readJsonFixture("on_time_delivery_no_partial_refund_needed_chat.json");
  const normalized = normalizeUploadedScenario(scenario);

  assert.strictEqual(Array.isArray(scenario), false);
  assert.strictEqual(normalized.id, "on_time_delivery_no_partial_refund_needed_chat");
  assert.deepStrictEqual(normalized.channels, ["chat"]);
  assert.ok(Array.isArray(normalized.frontend.chat.initialTranscript));
  assert.ok(Array.isArray(normalized.frontend.chat.guideSections));
});

test("chat frontend sends the matched step to Lambda before advancing progression", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const sendMessageBlock = chatHtml.match(/async function sendMessage\(\) \{[\s\S]*?async function getCustomerReply/);

  assert.ok(sendMessageBlock, "sendMessage block not found");
  assert.match(sendMessageBlock[0], /const responseStep = currentStep;/);
  assert.match(sendMessageBlock[0], /const nextStep = stepPassed/);
  assert.match(sendMessageBlock[0], /getCustomerReply\(text, stepPassed, responseStep\)/);
  assert.match(sendMessageBlock[0], /currentStep = nextStep;/);
  assert.doesNotMatch(sendMessageBlock[0], /if \(stepPassed\) \{\s*currentStep = Math\.min\(currentStep \+ 1, getStepConfigLength\(\)\);\s*\}/);

  const customerReplyBlock = chatHtml.match(/async function getCustomerReply[\s\S]*?async function getEvaluation/);
  assert.ok(customerReplyBlock, "getCustomerReply block not found");
  assert.match(customerReplyBlock[0], /currentStep: responseStep/);
  assert.match(customerReplyBlock[0], /currentStep: responseStep,\s*stepPassed,/);
  assert.match(customerReplyBlock[0], /FALLBACK_CUSTOMER_REPLIES\[Math\.min\(responseStep,/);
});

test("chat frontend evaluates grouped all and any progression rules", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const evaluateBlock = chatHtml.match(/function evaluateBackendStep\(message, step\) \{[\s\S]*?function evaluateCurrentStep/);

  assert.ok(evaluateBlock, "evaluateBackendStep block not found");
  assert.match(evaluateBlock[0], /allConditions\.every\(\(condition\) => evaluateStepCondition\(normalized, condition\)\)/);
  assert.match(evaluateBlock[0], /anyConditions\.some\(\(condition\) => evaluateStepCondition\(normalized, condition\)\)/);
  assert.match(evaluateBlock[0], /return allPassed && anyPassed;/);
});

test("chat frontend fallback step logic contains no unrelated delivery scenario details", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const start = chatHtml.indexOf("const STEP_CONFIG = [");
  const end = chatHtml.indexOf("const FALLBACK_CUSTOMER_REPLIES", start);

  assert.notStrictEqual(start, -1, "STEP_CONFIG fallback block start not found");
  assert.notStrictEqual(end, -1, "STEP_CONFIG fallback block end not found");

  const fallbackBlock = chatHtml.slice(start, end);
  assert.doesNotMatch(fallbackBlock, /\blarry\b/i);
  assert.doesNotMatch(fallbackBlock, /\belm street\b/i);
  assert.doesNotMatch(fallbackBlock, /\bel paso\b/i);
  assert.doesNotMatch(fallbackBlock, /\btuesday\b/i);
});

test("scenario client config preserves scripted chat customer responses", () => {
  const scenario = normalizeUploadedScenario({
    id: "scripted_chat",
    label: "Scripted Chat",
    title: "Scripted Chat",
    channels: ["chat"],
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "Hi, can you help?" }],
        guideSections: []
      }
    },
    chatConfig: {
      stepProgression: [
        {
          id: 0,
          label: "Ask pet name",
          match: { any: [{ op: "contains_any", phrases: ["puppy's name"] }] },
          customerResponse: "His name is Rocky and he's a Corgi."
        }
      ]
    },
    coaching: {
      qualityChecklist: [{ category: "Pet Engagement", behaviors: ["Asks about the pet."] }]
    }
  });

  const config = buildScenarioClientConfig(scenario);
  assert.strictEqual(config.chatConfig.stepProgression[0].label, "Ask pet name");
  assert.strictEqual(config.chatConfig.stepProgression[0].customerResponse, "His name is Rocky and he's a Corgi.");
});

test("chat scripted response rule overrides closing guidance", () => {
  const scenario = normalizeUploadedScenario({
    id: "scripted_close_guard_chat",
    label: "Scripted Close Guard",
    title: "Scripted Close Guard",
    channels: ["chat"],
    customer: {
      opening: {
        chat: "I need help with Larry's food."
      },
      persona: {
        name: "Demarco",
        tone: "Concerned"
      }
    },
    facts: {
      customerName: "Demarco",
      petName: "Larry",
      closingLine: "No, that's all for now. Thanks for your help."
    },
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "I need help with Larry's food." }],
        guideSections: []
      }
    },
    chatConfig: {
      stepProgression: [
        {
          id: 0,
          label: "Ask follow-up",
          match: { any: [{ op: "contains_any", phrases: ["everything looks accurate"] }] },
          customerResponse: "What happens if this order doesn't arrive on time?"
        }
      ]
    },
    coaching: {
      qualityChecklist: [{ category: "Expectation Setting", behaviors: ["Sets a next step."] }]
    }
  });

  const instructions = buildChatInstructions(scenario, 0);
  assert.match(instructions, /SCRIPTED RESPONSE RULE/);
  assert.match(instructions, /Current scripted response: "What happens if this order doesn't arrive on time\?"/);
  assert.match(instructions, /This scripted response overrides the closing line, general closing guidance, and generic customer behavior rules\./);
});

test("chat scripted response rule prevents adding later scripted beats", () => {
  const scenario = normalizeUploadedScenario({
    id: "scripted_step_guard_chat",
    label: "Scripted Step Guard",
    title: "Scripted Step Guard",
    channels: ["chat"],
    customer: {
      opening: {
        chat: "I need help with Larry's food."
      },
      persona: {
        name: "Demarco",
        tone: "Concerned"
      }
    },
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "I need help with Larry's food." }],
        guideSections: []
      }
    },
    chatConfig: {
      stepProgression: [
        {
          id: 0,
          label: "Confirm address",
          match: { any: [{ op: "contains_any", phrases: ["confirm your shipping address"] }] },
          customerResponse: "It's 1234 Elm Street in El Paso."
        },
        {
          id: 1,
          label: "Ask missed delivery follow-up",
          match: { any: [{ op: "contains_any", phrases: ["everything looks accurate"] }] },
          customerResponse: "What happens if this order doesn't arrive on time?"
        }
      ]
    },
    coaching: {
      qualityChecklist: [{ category: "Expectation Setting", behaviors: ["Sets a next step."] }]
    }
  });

  const addressStepInstructions = buildChatInstructions(scenario, 0);
  assert.match(addressStepInstructions, /Current scripted response: "It's 1234 Elm Street in El Paso\."/);
  assert.match(
    addressStepInstructions,
    /Do not add future customer questions, later scripted beats, closing lines, or extra content beyond the current scripted response\./
  );

  const followUpStepInstructions = buildChatInstructions(scenario, 1);
  assert.match(followUpStepInstructions, /Current scripted response: "What happens if this order doesn't arrive on time\?"/);
});

test("chat scripted response resolver drops later beats from generated response", () => {
  const generated =
    "It's 1234 Elm Street in El Paso. What happens if this order doesn't arrive on time?";
  const scripted = "It's 1234 Elm Street in El Paso.";

  assert.strictEqual(resolveChatCustomerMessage(generated, scripted, true), scripted);
  assert.strictEqual(resolveChatCustomerMessage(generated, scripted, false), generated);
});

test("chat scripted response is withheld when learner misses the current step", () => {
  const scenario = normalizeUploadedScenario({
    id: "scripted_off_path_chat",
    label: "Scripted Off Path",
    title: "Scripted Off Path",
    channels: ["chat"],
    customer: {
      opening: {
        chat: "I need help with Larry's food."
      },
      persona: {
        name: "Demarco",
        tone: "Concerned"
      }
    },
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "I need help with Larry's food." }],
        guideSections: []
      }
    },
    chatConfig: {
      stepProgression: [
        {
          id: 0,
          label: "Acknowledge and offer help",
          match: { any: [{ op: "contains_any", phrases: ["happy to help", "look into"] }] },
          customerResponse: "Thank you. I just want to be sure it gets here on time."
        }
      ]
    },
    coaching: {
      qualityChecklist: [{ category: "Problem Ownership", behaviors: ["Offers to help."] }]
    }
  });

  const instructions = buildChatInstructions(scenario, 0, { stepPassed: false });
  assert.doesNotMatch(instructions, /SCRIPTED RESPONSE RULE/);
  assert.doesNotMatch(instructions, /Current scripted response:/);
  assert.match(instructions, /OFF-PATH RESPONSE RULE/);
  assert.match(instructions, /Do not use the manager-approved scripted response yet\./);
  assert.match(instructions, /Acknowledge and offer help/);
});

test("customer behavior rules include scenario JSON behavior fields", () => {
  const scenario = normalizeUploadedScenario({
    id: "json_behavior_rules_chat",
    label: "JSON Behavior Rules",
    title: "JSON Behavior Rules",
    channels: ["chat"],
    customer: {
      opening: {
        chat: "I need help with my order."
      },
      persona: {
        name: "Customer",
        tone: "Concerned"
      },
      behavior: {
        rules: [
          "Only share the shipping address after the learner asks to verify it.",
          "Stay on the current beat when the learner gives a partial answer."
        ],
        conditionalFollowUps: [
          {
            condition: "If the learner skips the delivery expectation.",
            reply: "Can you tell me when it is actually arriving?"
          }
        ],
        allowedObjections: [
          "That still doesn't explain why it is late."
        ],
        softeningRule: "If the learner explains clearly and owns the next step, become calmer.",
        closingRule: "Close only after the learner recaps the refund and delivery plan.",
        closingLine: "Okay, thank you."
      }
    },
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "I need help with my order." }],
        guideSections: []
      }
    },
    coaching: {
      qualityChecklist: [{ category: "Ownership", behaviors: ["Owns the next step."] }]
    }
  });

  const instructions = buildChatInstructions(scenario, 0);

  assert.match(instructions, /Only share the shipping address after the learner asks to verify it\./);
  assert.match(instructions, /Stay on the current beat when the learner gives a partial answer\./);
  assert.match(instructions, /If the learner skips the delivery expectation\./);
  assert.match(instructions, /Can you tell me when it is actually arriving\?/);
  assert.match(instructions, /That still doesn't explain why it is late\./);
  assert.match(instructions, /If the learner explains clearly and owns the next step, become calmer\./);
  assert.match(instructions, /Close only after the learner recaps the refund and delivery plan\./);
});

test("customer behavior rules preserve legacy facts follow ups and objections", () => {
  const scenario = normalizeUploadedScenario({
    id: "legacy_behavior_rules_chat",
    label: "Legacy Behavior Rules",
    title: "Legacy Behavior Rules",
    channels: ["chat"],
    facts: {
      conditionalFollowUp: "If the learner is vague, ask for the tracking expectation.",
      allowedObjections: ["I am still worried this will miss the delivery window."]
    },
    customer: {
      opening: {
        chat: "I need help with my order."
      },
      persona: {
        name: "Customer",
        tone: "Concerned"
      }
    },
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "I need help with my order." }],
        guideSections: []
      }
    },
    coaching: {
      qualityChecklist: [{ category: "Ownership", behaviors: ["Owns the next step."] }]
    }
  });

  const instructions = buildChatInstructions(scenario, 0);

  assert.match(instructions, /If the learner is vague, ask for the tracking expectation\./);
  assert.match(instructions, /I am still worried this will miss the delivery window\./);
});

test("late delivery behavior rules come from scenario JSON without Lambda scenario id hardcoding", () => {
  const lambda = fs.readFileSync(path.join(repoRoot, "Lambda.js"), "utf8");
  const scenario = normalizeUploadedScenario(
    JSON.parse(fs.readFileSync(path.join(repoRoot, "scenarios", "late_delivery_20_partial_refund_chat.json"), "utf8"))
  );

  const instructions = buildChatInstructions(scenario, 0);

  assert.doesNotMatch(lambda, /scenarioSpecificRules/);
  assert.doesNotMatch(lambda, /on_time_delivery_no_partial_refund_needed/);
  assert.doesNotMatch(lambda, /delivery_promise_miss_10_partial_refund/);
  assert.match(instructions, /Do not reveal the shipping address until the learner asks for or confirms the shipping address\./);
  assert.match(instructions, /If the learner only partially completes the expected action, stay on the current beat/);
  assert.match(instructions, /If the learner acknowledges the frustration, explains the delay clearly, offers the correct refund with options, and sets expectations, become calmer and cooperative\./);
});

test("lambda infers chat step pass state when older clients omit it", () => {
  const scenario = normalizeUploadedScenario({
    id: "server_side_step_inference_chat",
    label: "Server Side Step Inference",
    title: "Server Side Step Inference",
    channels: ["chat"],
    customer: {
      opening: {
        chat: "I need help with Larry's food."
      },
      persona: {
        name: "Demarco",
        tone: "Concerned"
      }
    },
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "I need help with Larry's food." }],
        guideSections: []
      }
    },
    chatConfig: {
      stepProgression: [
        {
          id: 0,
          label: "Acknowledge and offer help",
          match: { any: [{ op: "contains_any", phrases: ["larry", "look into", "check the order"] }] },
          customerResponse: "Thank you. I just want to be sure it gets here on time."
        }
      ]
    },
    coaching: {
      qualityChecklist: [{ category: "Problem Ownership", behaviors: ["Offers to help."] }]
    }
  });

  assert.strictEqual(inferChatStepPassed(scenario, 0, "this is amazon wrong company!"), false);
  assert.strictEqual(inferChatStepPassed(scenario, 0, "I can check the order for Larry."), true);
});

test("late delivery chat progression requires complete learner behaviors for key beats", () => {
  const scenario = normalizeUploadedScenario(
    JSON.parse(fs.readFileSync(path.join(repoRoot, "scenarios", "late_delivery_20_partial_refund_chat.json"), "utf8"))
  );

  assert.strictEqual(scenario.id, LATE_DELIVERY_CHAT_SCENARIO_ID);
  assert.strictEqual(scenario.channels.join(","), "chat");

  const assertStep = (step, positive, negatives) => {
    assert.strictEqual(inferChatStepPassed(scenario, step, positive), true, `expected step ${step} to pass`);
    for (const negative of negatives) {
      assert.strictEqual(inferChatStepPassed(scenario, step, negative), false, `expected step ${step} to fail: ${negative}`);
    }
  };

  assertStep(1, "Could you confirm the shipping address on this order before I continue?", [
    "I'm checking your order now.",
    "I see the order for Fluffy's cat litter."
  ]);

  assertStep(
    2,
    "I verified 3948 Simpson Road. Severe weather near the fulfillment center delayed outbound deliveries, and tracking now shows it is scheduled to arrive tomorrow by end of day.",
    [
      "I verified 3948 Simpson Road and the delay was caused by severe weather near the fulfillment center.",
      "I verified 3948 Simpson Road and it is scheduled to arrive tomorrow by end of day."
    ]
  );

  assertStep(
    4,
    "I can offer the required 20% partial refund either back to your original payment method or as Chewy account credit, whichever you prefer.",
    [
      "I can offer a 20% partial refund back to your card.",
      "I can place the refund on your original payment method or as Chewy account credit."
    ]
  );

  assertStep(
    5,
    "I'll process that back to your original payment method now, and it should appear in 3 to 5 business days.",
    [
      "I'll process that back to your original payment method now.",
      "It should appear in 3 to 5 business days."
    ]
  );

  assertStep(
    6,
    "Your order is still scheduled to arrive tomorrow by end of day, and if it does not arrive then, please reach back out so we can help.",
    [
      "Your order is still scheduled to arrive tomorrow by end of day.",
      "If it does not arrive then, please reach back out so we can help."
    ]
  );
});

test("late delivery runtime scenarios are split into chat and voice sources", () => {
  const chatScenario = JSON.parse(fs.readFileSync(path.join(repoRoot, "scenarios", "late_delivery_20_partial_refund_chat.json"), "utf8"));
  const voiceScenario = JSON.parse(fs.readFileSync(path.join(repoRoot, "scenarios", "late_delivery_20_partial_refund.scenario.json"), "utf8"));

  assert.strictEqual(chatScenario.id, LATE_DELIVERY_CHAT_SCENARIO_ID);
  assert.strictEqual(chatScenario.channels.join(","), "chat");
  assert.ok(Array.isArray(chatScenario.simulation?.stateModel?.chatStepProgression));
  assert.strictEqual(chatScenario.simulation.stateModel.chatStepProgression.length, 7);

  assert.strictEqual(voiceScenario.id, LATE_DELIVERY_SCENARIO_ID);
  assert.strictEqual(voiceScenario.channels.join(","), "voice");
  assert.ok(voiceScenario.frontend?.voice, "base voice scenario should keep frontend.voice");
  assert.ok(!voiceScenario.frontend?.chat, "base voice scenario should not include frontend.chat");
  assert.ok(!voiceScenario.chatConfig, "base voice scenario should not include chatConfig");
  assert.ok(!voiceScenario.simulation?.stateModel?.chatStepProgression, "base voice scenario should not advertise chat progression");
});

test("realtime voice instructions include runtime customer beats in order", () => {
  const scenario = normalizeUploadedScenario({
    id: "voice_beats",
    label: "Voice Beats",
    title: "Voice Beats",
    channels: ["voice"],
    catalog: {
      description: "Demarco needs delivery reassurance for Larry's food."
    },
    customer: {
      opening: {
        voice: "I'm calling about Larry's food."
      },
      persona: {
        name: "Demarco",
        tone: "Concerned"
      }
    },
    facts: {
      customerName: "Demarco",
      petName: "Larry",
      address: "1234 Elm Street in El Paso",
      closingLine: "No, that's all for now. Thanks for your help."
    },
    simulation: {
      stateModel: {
        voiceStepProgression: [
          {
            id: 0,
            label: "Runtime voice beat",
            trigger: "Learner asks for runtime address verification.",
            customerResponse: "Runtime voice response."
          }
        ]
      },
      approvedTranscript: [
        {
          guidance: "Customer accepts reassurance.",
          idealAgentResponse: "Explain the order is on track and ask for address verification.",
          customer: "Thank you. I just want to be sure it gets here on time."
        },
        {
          guidance: "Customer provides address only when asked.",
          idealAgentResponse: "Confirm the full address back.",
          customer: "It's 1234 Elm Street in El Paso."
        }
      ]
    },
    frontend: {
      voice: {
        guideSections: [{ title: "Guide", bullets: ["Help Demarco."] }]
      }
    }
  });

  const instructions = buildRealtimeInstructions(scenario);
  assert.match(instructions, /APPROVED CUSTOMER BEATS/);
  assert.match(instructions, /Beat 1/);
  assert.match(instructions, /Purpose: Runtime voice beat/);
  assert.match(instructions, /Only use this beat when the learner has: Learner asks for runtime address verification\./);
  assert.match(instructions, /Customer should say: "Runtime voice response\."/);
  assert.doesNotMatch(instructions, /Thank you\. I just want to be sure it gets here on time\./);
  assert.match(instructions, /Follow these customer beats in order/);
});

test("batch scenario arrays are rejected by runtime normalization", () => {
  assert.throws(
    () => normalizeUploadedScenario([{ id: "one" }]),
    /Scenario body must be a single JSON object/
  );
});

test("scenario normalization mirrors chatConfig step progression into runtime state model", () => {
  const stepProgression = [
    {
      id: 0,
      label: "Verify details",
      match: { any: [{ op: "contains_any", phrases: ["address", "email"] }] },
      customerResponse: "Yes, that is correct.",
      scenarioPathHint: "chatConfig.stepProgression[0]"
    }
  ];

  const scenario = normalizeUploadedScenario({
    id: "mirror_test_chat",
    label: "Mirror Test",
    title: "Mirror Test",
    channels: ["chat"],
    frontend: {
      chat: {
        initialTranscript: [{ role: "assistant", content: "Hi, can you help?" }],
        guideSections: []
      }
    },
    chatConfig: { stepProgression },
    coaching: {
      qualityChecklist: [{ category: "Expectation Setting", behaviors: ["Sets a next step."] }]
    }
  });

  assert.deepStrictEqual(scenario.chatConfig.stepProgression, stepProgression);
  assert.deepStrictEqual(scenario.simulation.stateModel.chatStepProgression, stepProgression);
});

test("legacy successSignals normalize to contains_any chat progression rules", () => {
  assert.deepStrictEqual(
    normalizeChatStepProgression([
      {
        step: "confirm_order",
        successSignals: ["tracking", "address"],
        customerResponse: "Thanks for checking."
      }
    ]),
    [
      {
        id: 0,
        step: "confirm_order",
        customerResponse: "Thanks for checking.",
        match: {
          any: [{ op: "contains_any", phrases: ["tracking", "address"] }]
        }
      }
    ]
  );
});

test("unknown scenario ids do not silently fall back to the default scenario", async () => {
  const scenario = await getScenario("definitely_missing_scenario_id");
  assert.strictEqual(scenario, null);
});

test("lambda documents and uses the S3 single-object runtime scenario contract", () => {
  const lambda = fs.readFileSync(path.join(repoRoot, "Lambda.js"), "utf8");

  assert.match(lambda, /index\.json lists available scenarios/);
  assert.match(lambda, /scenarios\/\$\{scenarioId\}\.json/);
  assert.match(lambda, /Batch scenario array files are not supported at runtime/);
  assert.match(lambda, /SCENARIO_LIBRARY_BUCKET/);
});

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
