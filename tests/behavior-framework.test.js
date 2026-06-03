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
  getScenario
} = require(path.join(repoRoot, "Lambda.js")).__test;

const HOSTED_COACH_CHEWY_URL = "https://pub-f427f39912f4461691149d76a2e41031.r2.dev/Coach_Chewy_Circle_large.png";
const HOSTED_COACH_CHEWY_RE = new RegExp(HOSTED_COACH_CHEWY_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const LATE_DELIVERY_SCENARIO_ID = "late_delivery_20_partial_refund";

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
    transcript: "Agent: I can help with Fluffy's late litter order.",
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
  assert.strictEqual(item.coachSummaryText, "You handled the late delivery with clear ownership and helpful next steps.");
  assert.strictEqual(item.what_went_well, "You identified the delivery problem and gave a clear replacement timeline.");
  assert.strictEqual(item.what_to_strengthen_next, "Keep making empathy specific to the customer's situation.");
  assert.strictEqual(item.final_score, 66.7);
  assert.strictEqual(item.focus_behavior, "problem_ownership");
  assert.ok(!Object.hasOwn(item, "agentName"));
  assert.ok(!Object.hasOwn(item, "learner_employee_id"));
  assert.ok(!Object.hasOwn(item, "learner_username"));
  assert.ok(!Object.hasOwn(item, "learner_email"));
  assert.ok(!Object.hasOwn(item, "learner_identity_source"));
  assert.ok(!Object.hasOwn(item, "record_type"));
  assert.ok(!Object.hasOwn(item, "scenarioLabel"));
  assert.ok(!Object.hasOwn(item, "course_id"));
  assert.ok(!Object.hasOwn(item, "created_at"));
  assert.ok(!Object.hasOwn(item, "total_score_numerator"));
  assert.ok(!Object.hasOwn(item, "total_score_denominator"));
  assert.ok(!Object.hasOwn(item, "strongest_behaviors"));
  assert.ok(!Object.hasOwn(item, "behavior_results"));
  assert.ok(!Object.hasOwn(item, "transcript"));
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

test("chat and voice default to the late delivery partial refund scenario", () => {
  const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");

  assert.match(chatHtml, new RegExp(`const SCENARIO_OVERRIDE = "${LATE_DELIVERY_SCENARIO_ID}"`));
  assert.match(voiceHtml, new RegExp(`const SCENARIO_OVERRIDE = "${LATE_DELIVERY_SCENARIO_ID}"`));
  assert.match(chatHtml, new RegExp(`const DEFAULT_SCENARIO_ID = "${LATE_DELIVERY_SCENARIO_ID}"`));
  assert.match(voiceHtml, new RegExp(`const DEFAULT_SCENARIO_ID = "${LATE_DELIVERY_SCENARIO_ID}"`));
  assert.match(chatHtml, /const STATIC_CHAT_INSTRUCTIONS = \[/);
  assert.doesNotMatch(chatHtml, /const DEFAULT_SCENARIO_ID = "id":/);
  assert.doesNotMatch(voiceHtml, /const DEFAULT_SCENARIO_ID = "id":/);
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
  assert.match(customerReplyBlock[0], /FALLBACK_CUSTOMER_REPLIES\[Math\.min\(responseStep,/);
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
