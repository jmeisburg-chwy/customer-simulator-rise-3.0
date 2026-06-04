#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const OFFICIAL_BEHAVIORS = [
  "issue_understanding",
  "emotional_acknowledgement",
  "problem_ownership",
  "personalization",
  "expectation_setting",
  "pet_engagement",
  "communication_style"
];

const RATING_SCORES = {
  "To a Great Extent": { numerator: 100, denominator: 1 },
  "To Some Extent": { numerator: 50, denominator: 1 },
  "Missed Opportunity": { numerator: 0, denominator: 1 },
  "No Opportunity": { numerator: 0, denominator: 0 }
};

const repoRoot = path.resolve(__dirname, "..", "..");
const defaultFixtureDir = path.join(__dirname, "fixtures");
const fixtureRoot = path.resolve(process.argv[2] || defaultFixtureDir);
const evalApiUrl = String(process.env.EVAL_API_URL || "").trim();
const scoreTolerance = Number(process.env.CALIBRATION_SCORE_TOLERANCE || 10);

function listJsonFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".json") ? [fullPath] : [];
  }).sort();
}

function readFixture(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getExpectedRatings(fixture) {
  return fixture.expected_behavior_ratings || fixture.expectedBehaviorRatings || {};
}

function ratingToScore(rating) {
  return RATING_SCORES[rating] || null;
}

function calculateFinalScore(ratings) {
  const totals = OFFICIAL_BEHAVIORS.reduce(
    (acc, behavior) => {
      const score = ratingToScore(ratings[behavior]);
      if (!score) return acc;
      acc.numerator += score.numerator;
      acc.denominator += score.denominator;
      return acc;
    },
    { numerator: 0, denominator: 0 }
  );

  return {
    ...totals,
    final_score: totals.denominator ? Math.round((totals.numerator / totals.denominator) * 10) / 10 : 0
  };
}

function validateFixture(fixture, filePath) {
  const errors = [];
  const ratings = getExpectedRatings(fixture);

  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    return ["Fixture must be a JSON object."];
  }

  if (!String(fixture.scenario_id || "").trim()) errors.push("scenario_id is required.");
  if (!["chat", "voice"].includes(String(fixture.channel || "").trim())) errors.push("channel must be chat or voice.");
  if (!String(fixture.transcript || "").trim()) errors.push("transcript is required.");
  if (!String(fixture.trainer_notes || "").trim()) errors.push("trainer_notes is required.");
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) {
    errors.push("expected_behavior_ratings must be an object.");
  }

  for (const behavior of OFFICIAL_BEHAVIORS) {
    const rating = ratings[behavior];
    if (!rating) {
      errors.push(`expected_behavior_ratings.${behavior} is required.`);
    } else if (!ratingToScore(rating)) {
      errors.push(`expected_behavior_ratings.${behavior} has unsupported rating "${rating}".`);
    }
  }

  const extra = Object.keys(ratings).filter((behavior) => !OFFICIAL_BEHAVIORS.includes(behavior));
  if (extra.length) errors.push(`expected_behavior_ratings has unsupported behavior keys: ${extra.join(", ")}.`);

  return errors.map((error) => `${path.relative(repoRoot, filePath)}: ${error}`);
}

function normalizeAiRatings(response) {
  const results = Array.isArray(response?.behavior_results)
    ? response.behavior_results
    : Array.isArray(response?.behaviors)
      ? response.behaviors
      : Array.isArray(response?.coaching?.behavior_results)
        ? response.coaching.behavior_results
        : [];

  return results.reduce((acc, item) => {
    const behavior = String(item?.behavior_name || item?.behaviorName || "").trim();
    const rating = String(item?.rating || "").trim();
    if (behavior && rating) acc[behavior] = rating;
    return acc;
  }, {});
}

async function evaluateLive(fixture) {
  const response = await fetch(evalApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenarioId: fixture.scenario_id,
      scenario_id: fixture.scenario_id,
      channel: fixture.channel,
      transcript: fixture.transcript
    })
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`EVAL_API_URL returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`EVAL_API_URL returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return body;
}

function compareRatings(expected, actual) {
  return OFFICIAL_BEHAVIORS.map((behavior) => ({
    behavior,
    expected: expected[behavior],
    actual: actual[behavior] || "(missing)",
    match: expected[behavior] === actual[behavior]
  }));
}

async function main() {
  if (!fs.existsSync(fixtureRoot)) {
    throw new Error(`Calibration fixture path not found: ${fixtureRoot}`);
  }

  const files = listJsonFiles(fixtureRoot);
  if (!files.length) throw new Error(`No calibration fixtures found under ${fixtureRoot}`);

  console.log("Calibration mode:", evalApiUrl ? "live" : "offline");
  console.log("Fixture root:", path.relative(repoRoot, fixtureRoot) || ".");
  if (evalApiUrl) {
    console.log("Evaluate URL:", evalApiUrl);
    console.log("Score tolerance:", scoreTolerance);
  }
  console.log("");

  const rows = [];
  const validationErrors = [];

  for (const file of files) {
    const fixture = readFixture(file);
    const errors = validateFixture(fixture, file);
    validationErrors.push(...errors);
    if (errors.length) continue;

    const expectedRatings = getExpectedRatings(fixture);
    const expectedScore = calculateFinalScore(expectedRatings);
    const row = {
      file: path.relative(repoRoot, file),
      id: fixture.id || path.basename(file, ".json"),
      scenario_id: fixture.scenario_id,
      channel: fixture.channel,
      expected_final_score: expectedScore.final_score,
      exact_matches: "",
      mismatches: "",
      final_score_difference: "",
      status: "OK"
    };

    if (evalApiUrl) {
      const liveResponse = await evaluateLive(fixture);
      const actualRatings = normalizeAiRatings(liveResponse);
      const comparisons = compareRatings(expectedRatings, actualRatings);
      const actualScore = calculateFinalScore(actualRatings);
      const mismatches = comparisons.filter((item) => !item.match);
      const scoreDifference = Math.round(Math.abs(actualScore.final_score - expectedScore.final_score) * 10) / 10;

      row.actual_final_score = actualScore.final_score;
      row.exact_matches = String(comparisons.length - mismatches.length);
      row.mismatches = String(mismatches.length);
      row.final_score_difference = String(scoreDifference);
      row.status = scoreDifference <= scoreTolerance ? "PASS" : "FAIL";
      row.mismatch_detail = mismatches
        .map((item) => `${item.behavior}: expected ${item.expected}, got ${item.actual}`)
        .join(" | ");
    }

    rows.push(row);
  }

  if (validationErrors.length) {
    console.error("Calibration validation failed:");
    validationErrors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.table(rows.map((row) => ({
    fixture: row.id,
    scenario_id: row.scenario_id,
    channel: row.channel,
    expected_final_score: row.expected_final_score,
    actual_final_score: row.actual_final_score || "",
    exact_matches: row.exact_matches,
    mismatches: row.mismatches,
    final_score_difference: row.final_score_difference,
    status: row.status
  })));

  if (evalApiUrl) {
    const failures = rows.filter((row) => row.status !== "PASS");
    const mismatches = rows.filter((row) => row.mismatch_detail);
    if (mismatches.length) {
      console.log("\nRating mismatches:");
      mismatches.forEach((row) => console.log(`- ${row.id}: ${row.mismatch_detail}`));
    }
    if (failures.length) process.exitCode = 1;
  }

  console.log(`\nValidated ${rows.length} calibration fixture(s).`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
