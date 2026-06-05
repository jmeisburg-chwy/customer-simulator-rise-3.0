#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const distRoot = path.join(repoRoot, "dist");
const libraryRoot = path.join(distRoot, "scenario-library");
const scenariosRoot = path.join(libraryRoot, "scenarios");
const sourceScenarios = [
  "late_delivery_20_partial_refund_chat.json",
  "late_delivery_20_partial_refund.scenario.json"
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeSeedName(filename) {
  return filename.replace(/\.scenario\.json$/, ".json");
}

fs.mkdirSync(scenariosRoot, { recursive: true });

const entries = sourceScenarios.map((filename) => {
  const sourcePath = path.join(repoRoot, "scenarios", filename);
  const scenario = readJson(sourcePath);
  const seedName = normalizeSeedName(filename);
  const destinationPath = path.join(scenariosRoot, seedName);

  fs.copyFileSync(sourcePath, destinationPath);

  const catalog = scenario.catalog && typeof scenario.catalog === "object" ? scenario.catalog : {};
  return {
    id: scenario.id,
    label: catalog.label || scenario.label || scenario.title || scenario.id,
    title: catalog.title || scenario.title || scenario.label || scenario.id,
    shortTitle: catalog.shortTitle || catalog.title || scenario.title || scenario.id,
    description: catalog.description || "",
    channels: Array.isArray(scenario.channels) ? scenario.channels : [],
    path: `scenarios/${seedName}`
  };
});

fs.writeFileSync(
  path.join(libraryRoot, "index.json"),
  `${JSON.stringify({ scenarios: entries }, null, 2)}\n`
);

console.log(`Prepared scenario library assets in ${libraryRoot}`);
console.log("");
console.log("Upload with:");
console.log("aws s3 sync dist/scenario-library s3://customer-simulator-deploy/customer-simulator-rise/scenario-library --delete");
