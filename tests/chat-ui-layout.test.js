const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
const voiceHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-VoiceExperience.html"), "utf8");
const scenarioTemplate = JSON.parse(fs.readFileSync(path.join(repoRoot, "scenario-template.json"), "utf8"));

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function runTests() {
  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      throw error;
    }
  }
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = chatHtml.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\s*\\}`, "m"));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[0];
}

function scriptBlock(name, nextName) {
  const start = chatHtml.indexOf(`function ${name}`);
  assert.notStrictEqual(start, -1, `${name} block not found`);
  const end = nextName ? chatHtml.indexOf(`function ${nextName}`, start) : chatHtml.indexOf("</script>", start);
  assert.notStrictEqual(end, -1, `${nextName || "script end"} not found after ${name}`);
  return chatHtml.slice(start, end);
}

test("AWR shell renders System Tools beside a Customer Chat sidebar without persistent Coach Chewy phases", () => {
  assert.match(chatHtml, /<aside class="panel system-tools-panel"/);
  assert.match(chatHtml, /<div class="workspace-resizer"[^>]*id="workspaceResizer"/);
  assert.doesNotMatch(chatHtml, /<aside class="right-sidebar"/);
  assert.match(chatHtml, /<section class="panel chat-panel"/);
  assert.match(chatHtml, /<aside class="panel coach-panel"/);
  assert.match(chatHtml, /Coach Chewy/);
  assert.match(chatHtml, /Customer: Customer/);
  assert.match(chatHtml, /chatHeaderTitle\.textContent = `Customer: \$\{getChatCustomerDisplayName\(\)\}`/);
  assert.match(chatHtml, /System Tools/);

  const appRule = cssRule(".app");
  assert.match(appRule, /grid-template-columns:\s*minmax\(54%,\s*var\(--system-tools-width,\s*60%\)\)\s+12px\s+minmax\(320px,\s*1fr\)/);
  assert.doesNotMatch(appRule, /0\.55fr\s+0\.65fr\s+1\.4fr/);
  assert.doesNotMatch(chatHtml, /class="system-screen-title"/);
  assert.doesNotMatch(chatHtml, /class="system-fact-area"/);

  const coachRule = cssRule(".coach-panel");
  assert.match(coachRule, /border-radius:\s*12px/);
  assert.match(coachRule, /display:\s*grid/);
});

test("workspace divider persists session width and clamps System Tools between 54 and 66 percent", () => {
  assert.match(chatHtml, /const WORKSPACE_WIDTH_STORAGE_KEY = "ccs_workspace_system_tools_width"/);
  assert.match(chatHtml, /const SYSTEM_TOOLS_DEFAULT_WIDTH = 60/);
  assert.match(chatHtml, /const SYSTEM_TOOLS_MIN_WIDTH = 54/);
  assert.match(chatHtml, /const SYSTEM_TOOLS_MAX_WIDTH = 66/);
  assert.match(chatHtml, /sessionStorage\.getItem\(WORKSPACE_WIDTH_STORAGE_KEY\)/);
  assert.match(chatHtml, /sessionStorage\.setItem\(WORKSPACE_WIDTH_STORAGE_KEY,\s*String\(nextWidth\)\)/);
  assert.match(chatHtml, /clampSystemToolsWidth/);
  assert.match(chatHtml, /workspaceResizer\.addEventListener\("pointerdown", startWorkspaceResize\)/);
});

test("full preview mode hides Rise chrome and expands simulator to the browser viewport", () => {
  const previewPageRule = cssRule("html.full-preview .page");
  assert.match(previewPageRule, /height:\s*100vh/);
  assert.match(previewPageRule, /overflow:\s*hidden/);

  const instructionsRule = cssRule("html.full-preview .instructions-wrap");
  assert.match(instructionsRule, /display:\s*none/);

  const bodyRule = cssRule("html.full-preview .experience-body");
  assert.match(bodyRule, /height:\s*100%/);
  assert.match(bodyRule, /padding:\s*0/);

  const viewportRule = cssRule("html.full-preview .viewport");
  assert.match(viewportRule, /height:\s*100vh/);
  assert.match(viewportRule, /border-radius:\s*0/);

  assert.match(chatHtml, /const IS_FULL_PREVIEW = /);
  assert.match(chatHtml, /document\.documentElement\.classList\.add\("full-preview"\)/);
  assert.doesNotMatch(chatHtml, /const DESIGN_WIDTH|const DESIGN_HEIGHT|function fitStage/);
  assert.doesNotMatch(chatHtml, /id="stage"|class="stage"/);
});

test("System Tools uses systemWalkthrough screens, image assetKey, hotspots, facts, and navigation", () => {
  assert.match(chatHtml, /systemWalkthrough/);
  assert.doesNotMatch(chatHtml, /frontend\?\.chat\?\.systemTools|frontend\.chat\.systemTools|systemTools:/);
  assert.match(chatHtml, /const systemWalkthroughEvents = \[\]/);
  assert.match(chatHtml, /walkthroughImageEl/);
  assert.match(chatHtml, /walkthroughHotspotLayerEl/);
  assert.match(chatHtml, /recordSystemWalkthroughEvent/);

  const renderBlock = scriptBlock("renderSystemWalkthrough", "setActiveSystemScreen");
  assert.match(renderBlock, /\.screens/);

  const screenBlock = scriptBlock("setActiveSystemScreen", "handleSystemHotspotClick");
  assert.match(screenBlock, /image\.assetKey/);
  assert.match(screenBlock, /hotspots/);
  assert.match(screenBlock, /applyHotspotPosition\(button, hotspot\)/);

  const positionBlock = scriptBlock("applyHotspotPosition", "positionSystemGuideTooltip");
  assert.match(positionBlock, /left\s*=\s*`\$\{hotspot\.x\}%`/);
  assert.match(positionBlock, /width\s*=\s*`\$\{hotspot\.width\}%`/);

  const clickBlock = scriptBlock("handleSystemHotspotClick", "showSystemFact");
  assert.match(clickBlock, /targetScreenId/);
  assert.match(clickBlock, /hotspot\.fact/);
  assert.match(clickBlock, /recordSystemWalkthroughEvent/);
});

test("Experience Mode is normalized as runtime state outside System Tools", () => {
  assert.match(chatHtml, /function normalizeExperienceMode\(value\)/);
  assert.match(chatHtml, /function resolveExperienceModeOverride\(\)/);
  assert.match(chatHtml, /const EXPERIENCE_MODE_OVERRIDE = resolveExperienceModeOverride\(\)/);
  assert.match(chatHtml, /let runtimeExperienceMode = "learn"/);

  const applyBlock = scriptBlock("applyScenarioDisplayConfig", "loadScenarioDisplayConfig");
  assert.match(applyBlock, /runtimeExperienceMode = normalizeExperienceMode\(EXPERIENCE_MODE_OVERRIDE \|\| \(EXPERIENCE_MODE_LOCKED \? config\?\.experienceMode : "learn"\)\)/);
  assert.doesNotMatch(chatHtml, /function normalizeSystemWalkthroughMode\(value\)/);
  assert.doesNotMatch(chatHtml, /mode:\s*normalizeSystemWalkthroughMode\(walkthrough\.mode\)/);
  assert.doesNotMatch(chatHtml, /chat_step_passed/);
  assert.doesNotMatch(chatHtml, /frontend\?\.chat\?\.systemTools|frontend\.chat\.systemTools|systemTools:/);
});

test("Experience Mode capabilities centralize behavior by mode", () => {
  const capabilitiesStart = chatHtml.indexOf("const EXPERIENCE_MODE_CAPABILITIES");
  assert.notStrictEqual(capabilitiesStart, -1, "Experience Mode capabilities definition not found");
  const capabilitiesEnd = chatHtml.indexOf("const COACH_CHEWY_IMAGE_SRC", capabilitiesStart);
  assert.notStrictEqual(capabilitiesEnd, -1, "Capabilities definition should live with Experience Mode constants");
  const capabilitiesBlock = chatHtml.slice(capabilitiesStart, capabilitiesEnd);

  [
    "autoPlayChat",
    "autoNavigateSystemTools",
    "showHints",
    "showCoachChewy",
    "allowLearnerResponse",
    "generateEvaluation",
    "generateCoachingReport",
    "showCompletionRecommendations"
  ].forEach((capability) => assert.match(capabilitiesBlock, new RegExp(`${capability}:`)));

  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*autoPlayChat:\s*true/);
  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*autoNavigateSystemTools:\s*true/);
  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*showHints:\s*false/);
  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*showCoachChewy:\s*false/);
  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*allowLearnerResponse:\s*false/);
  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*generateEvaluation:\s*false/);
  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*generateCoachingReport:\s*false/);
  assert.match(capabilitiesBlock, /learn:\s*Object\.freeze\(\{[\s\S]*showCompletionRecommendations:\s*true/);

  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*autoPlayChat:\s*false/);
  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*autoNavigateSystemTools:\s*false/);
  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*showHints:\s*true/);
  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*showCoachChewy:\s*true/);
  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*allowLearnerResponse:\s*true/);
  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*generateEvaluation:\s*false/);
  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*generateCoachingReport:\s*false/);
  assert.match(capabilitiesBlock, /practice:\s*Object\.freeze\(\{[\s\S]*showCompletionRecommendations:\s*true/);

  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*autoPlayChat:\s*false/);
  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*autoNavigateSystemTools:\s*false/);
  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*showHints:\s*true/);
  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*showCoachChewy:\s*true/);
  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*allowLearnerResponse:\s*true/);
  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*generateEvaluation:\s*true/);
  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*generateCoachingReport:\s*true/);
  assert.match(capabilitiesBlock, /apply:\s*Object\.freeze\(\{[\s\S]*showCompletionRecommendations:\s*false/);

  const resolverBlock = scriptBlock("getExperienceModeCapabilities", "modeAllows");
  assert.match(resolverBlock, /normalizeExperienceMode\(mode\)/);
  assert.match(resolverBlock, /EXPERIENCE_MODE_CAPABILITIES\[normalizedMode\]/);
  assert.match(resolverBlock, /EXPERIENCE_MODE_CAPABILITIES\.apply/);

  const allowsBlock = scriptBlock("modeAllows", "updateExperienceModeClass");
  assert.match(allowsBlock, /getExperienceModeCapabilities\(mode\)/);
  assert.match(allowsBlock, /capabilities\[capability\] === true/);
});

test("Experience Mode runtime override is passed when loading scenario config", () => {
  const loadBlock = scriptBlock("loadScenarioDisplayConfig", "appendMessage");
  assert.match(loadBlock, /new URLSearchParams\(\{\s*scenarioId: SCENARIO_ID\s*\}\)/);
  assert.match(loadBlock, /if \(EXPERIENCE_MODE_OVERRIDE\)/);
  assert.match(loadBlock, /params\.set\("experienceMode", EXPERIENCE_MODE_OVERRIDE\)/);
  assert.match(loadBlock, /params\.set\("channel", runtimeExperienceChannel\)/);
  assert.match(loadBlock, /`\$\{SCENARIO_CONFIG_URL\}\?\$\{params\.toString\(\)\}`/);
});

test("neutral Customer Simulator launch supports channel selection, scenario summary, Learn default, locks, and autoStart", () => {
  assert.match(chatHtml, /id="launchScenarioTitle"/);
  assert.match(chatHtml, /id="launchScenarioDescription"/);
  assert.match(chatHtml, /Which channel do you support\?/);
  assert.match(chatHtml, /id="experienceChannelOptions"/);
  assert.match(chatHtml, /id="experienceModeStart"/);
  assert.match(chatHtml, /id="experienceModeOptions"/);
  assert.match(chatHtml, /Start Simulation/);
  assert.match(chatHtml, /mode:\s*"chat"/);
  assert.match(chatHtml, /mode:\s*"voice"/);
  assert.match(chatHtml, /mode:\s*"learn"/);
  assert.match(chatHtml, /mode:\s*"practice"/);
  assert.match(chatHtml, /mode:\s*"apply"/);
  assert.match(chatHtml, /let runtimeExperienceChannel = "chat"/);
  assert.match(chatHtml, /let runtimeExperienceMode = "learn"/);
  assert.match(chatHtml, /function normalizeExperienceChannel\(value\)/);
  assert.match(chatHtml, /function resolveChannelOverride\(\)/);
  assert.match(chatHtml, /function resolveChannelLock\(\)/);
  assert.match(chatHtml, /const EXPERIENCE_CHANNEL_OVERRIDE = resolveChannelOverride\(\)/);
  assert.match(chatHtml, /const EXPERIENCE_CHANNEL_LOCKED = resolveChannelLock\(\)/);
  assert.match(chatHtml, /getExperienceChannelLabel\(runtimeExperienceChannel\)/);
  assert.match(chatHtml, /Chat · Learn Mode/);
  assert.match(chatHtml, /button\.dataset\.experienceMode = option\.mode/);
  assert.match(chatHtml, /button\.dataset\.experienceChannel = option\.mode/);
  assert.match(chatHtml, /Observe a complete example before trying it yourself\./);
  assert.match(chatHtml, /Try the scenario with support and coaching\./);
  assert.match(chatHtml, /Demonstrate your skills independently\./);
  assert.doesNotMatch(chatHtml, />Chat Experience</);
  assert.doesNotMatch(chatHtml, /Hide Chat Experience/);

  assert.match(chatHtml, /function resolveExperienceModeLock\(\)/);
  assert.match(chatHtml, /function resolveExperienceModeAutoStart\(\)/);
  assert.match(chatHtml, /const EXPERIENCE_MODE_LOCKED = resolveExperienceModeLock\(\)/);
  assert.match(chatHtml, /const EXPERIENCE_MODE_AUTO_START = resolveExperienceModeAutoStart\(\)/);
  assert.match(chatHtml, /function renderExperienceModeStart\(\)/);
  assert.match(chatHtml, /function shouldAutoStartExperience\(\)/);
  assert.match(chatHtml, /function launchExperienceMode\(mode = runtimeExperienceMode\)/);

  const renderBlock = scriptBlock("renderExperienceModeStart", "shouldAutoStartExperience");
  assert.match(renderBlock, /experienceModeStartEl\.classList\.add\("active"\)/);
  assert.match(renderBlock, /experienceModeOptionsEl\.innerHTML = ""/);
  assert.match(renderBlock, /experienceChannelOptionsEl\.innerHTML = ""/);
  assert.match(renderBlock, /EXPERIENCE_CHANNEL_LOCKED \? \[runtimeExperienceChannel\] : getAvailableChannelOptions\(\)/);
  assert.match(renderBlock, /EXPERIENCE_MODE_LOCKED \? \[runtimeExperienceMode\] : EXPERIENCE_MODE_OPTIONS/);
  assert.match(renderBlock, /option\.mode === runtimeExperienceMode/);
  assert.match(renderBlock, /runtimeExperienceMode = normalizeExperienceMode\(option\.mode\)/);
  assert.match(renderBlock, /runtimeExperienceChannel = normalizeExperienceChannel\(option\.mode\)/);
  assert.match(renderBlock, /Assigned by your learning path/);

  const autoStartBlock = scriptBlock("shouldAutoStartExperience", "hideExperienceModeStart");
  assert.match(autoStartBlock, /EXPERIENCE_CHANNEL_LOCKED && EXPERIENCE_MODE_LOCKED && EXPERIENCE_MODE_AUTO_START/);
});

test("Experience Mode launch gates chat start and keeps a persistent mode badge visible", () => {
  assert.match(chatHtml, /id="experienceModeBadge"/);
  assert.match(chatHtml, /class="experience-mode-badge"/);

  const badgeRule = cssRule(".experience-mode-badge");
  assert.match(badgeRule, /border-radius:\s*999px/);

  const badgeBlock = scriptBlock("renderExperienceModeBadge", "renderExperienceModeStart");
  assert.match(badgeBlock, /experienceModeBadgeEl\.textContent = `\$\{getExperienceChannelLabel\(runtimeExperienceChannel\)\} · \$\{getExperienceModeLabel\(runtimeExperienceMode\)\}`/);
  assert.match(badgeBlock, /experienceModeBadgeEl\.dataset\.experienceMode = runtimeExperienceMode/);
  assert.match(badgeBlock, /experienceModeBadgeEl\.dataset\.experienceChannel = runtimeExperienceChannel/);

  const launchBlock = scriptBlock("launchExperienceMode", "renderScenarioUnavailable");
  assert.match(launchBlock, /function launchExperienceMode\(mode = runtimeExperienceMode\)/);
  assert.match(launchBlock, /runtimeExperienceMode = normalizeExperienceMode\(mode\)/);
  assert.match(launchBlock, /if \(runtimeExperienceChannel === "voice"\)/);
  assert.match(launchBlock, /routeToVoiceExperience\(\)/);
  assert.match(launchBlock, /hasExperienceLaunched = true/);
  assert.match(launchBlock, /hideExperienceModeStart\(\)/);
  assert.match(launchBlock, /renderExperienceModeBadge\(\)/);
  assert.match(launchBlock, /beginChatSession\(\)/);

  const initializeBlock = scriptBlock("initializeChatExperience");
  assert.match(initializeBlock, /hasExperienceLaunched = false/);
  assert.match(initializeBlock, /renderExperienceModeBadge\(\)/);
  assert.match(initializeBlock, /if \(shouldAutoStartExperience\(\)\)/);
  assert.match(initializeBlock, /renderExperienceModeStart\(\)/);
  assert.doesNotMatch(initializeBlock, /beginChatSession\(\);/);
});

test("System Tools moments remain content-only and do not imply mode behavior", () => {
  assert.match(chatHtml, /function normalizeSystemWalkthroughMoments\(moments, screens\)/);
  assert.match(chatHtml, /moments:\s*normalizeSystemWalkthroughMoments\(walkthrough\.moments, screens\)/);
  assert.doesNotMatch(chatHtml, /walkthrough\.mode/);
  assert.doesNotMatch(chatHtml, /frontend\?\.chat\?\.systemTools|frontend\.chat\.systemTools|systemTools:/);
});

test("Learn Mode auto-advances chat and System Tools from moments without changing Practice or Apply", () => {
  assert.match(chatHtml, /id="learnModeControls"/);
  assert.match(chatHtml, /id="learnPauseBtn"/);
  assert.match(chatHtml, /id="learnResumeBtn"/);
  assert.match(chatHtml, /id="learnRestartBtn"/);
  assert.match(chatHtml, /id="learnCompletionPanel"/);
  assert.match(chatHtml, /You have completed the demonstration\./);
  assert.match(chatHtml, /Practice This Scenario/);
  assert.match(chatHtml, /Try Apply Mode/);
  assert.match(chatHtml, /Restart Demonstration/);

  assert.match(chatHtml, /function isLearnMode\(\)/);
  assert.match(chatHtml, /function startLearnModeAutomation\(\)/);
  assert.match(chatHtml, /function scheduleNextLearnModeStep/);
  assert.match(chatHtml, /function getLearnModeStepCount\(\)/);
  assert.match(chatHtml, /function advanceLearnModeStep\(\)/);
  assert.match(chatHtml, /function activateSystemWalkthroughMoment\(stepId, trigger/);
  assert.match(chatHtml, /function completeLearnModeDemo\(\)/);
  assert.match(chatHtml, /function pauseLearnModeDemo\(\)/);
  assert.match(chatHtml, /function resumeLearnModeDemo\(\)/);
  assert.match(chatHtml, /function restartLearnModeDemo\(\)/);

  const launchBlock = scriptBlock("launchExperienceMode", "renderScenarioUnavailable");
  assert.match(launchBlock, /if \(modeAllows\("autoPlayChat"\)\)/);
  assert.match(launchBlock, /startLearnModeAutomation\(\)/);
  assert.match(launchBlock, /else beginChatSession\(\)/);

  const beginBlock = scriptBlock("beginChatSession", "buildQualityBehaviorsFromEvaluation");
  assert.match(beginBlock, /updateLearnModeControls\(\)/);
  assert.match(beginBlock, /if \(modeAllows\("allowLearnerResponse"\)\) composerEl\.focus\(\)/);

  const advanceBlock = scriptBlock("advanceLearnModeStep", "completeLearnModeDemo");
  assert.match(advanceBlock, /getLearnModeStepCount\(\)/);
  assert.match(advanceBlock, /appendMessage\("agent"/);
  assert.match(advanceBlock, /appendMessage\("assistant"/);
  assert.match(advanceBlock, /if \(modeAllows\("autoNavigateSystemTools"\)\)/);
  assert.match(advanceBlock, /activateSystemWalkthroughMoment\(stepId, "ideal_step_started"\)/);
  assert.match(advanceBlock, /currentStep = stepId \+ 1/);

  const momentBlock = scriptBlock("activateSystemWalkthroughMoment", "getLearnModeAgentResponse");
  assert.match(momentBlock, /runtimeSystemWalkthrough\?\.moments/);
  assert.match(momentBlock, /item\.stepId === stepId/);
  assert.match(momentBlock, /setActiveSystemScreen\(moment\.screenId/);
  assert.match(momentBlock, /recordSystemWalkthroughEvent/);
  assert.match(momentBlock, /momentId/);
  assert.match(momentBlock, /trigger/);

  const sendBlock = scriptBlock("sendMessage", "getCustomerReply");
  assert.match(sendBlock, /!modeAllows\("allowLearnerResponse"\)/);
  assert.match(sendBlock, /return/);

  const appendBlock = scriptBlock("appendMessage", "appendInlineCoachTip");
  assert.match(appendBlock, /isCustomerRole\(role\) && modeAllows\("showHints"\)/);

  const endStart = chatHtml.indexOf("async function completeEndChat");
  const endBlock = chatHtml.slice(endStart, chatHtml.indexOf('chatAccordion.addEventListener("toggle"', endStart));
  assert.match(endBlock, /!modeAllows\("generateEvaluation"\)/);
  assert.match(endBlock, /!modeAllows\("generateCoachingReport"\)/);
  assert.match(endBlock, /isLearnMode\(\)/);
});

test("Voice Learn renders MP3 controls, uses canonical moments for screenshots, and skips grading paths", () => {
  assert.match(voiceHtml, /function normalizeExperienceMode\(value\)/);
  assert.match(voiceHtml, /function normalizeExperienceChannel\(value\)/);
  assert.match(voiceHtml, /function resolveChannelOverride\(\)/);
  assert.match(voiceHtml, /function resolveChannelLock\(\)/);
  assert.match(voiceHtml, /id="voiceLearnPanel"/);
  assert.match(voiceHtml, /id="voiceLearnAudio"/);
  assert.match(voiceHtml, /id="voiceLearnPlayBtn"/);
  assert.match(voiceHtml, /id="voiceLearnPauseBtn"/);
  assert.match(voiceHtml, /id="voiceLearnRestartBtn"/);
  assert.match(voiceHtml, /id="voiceExperienceBadge"/);
  assert.match(voiceHtml, /Voice · Learn Mode/);
  assert.match(voiceHtml, /<details id="voiceAccordion" open>/);
  assert.match(voiceHtml, /Listen to the modeled customer and agent conversation\./);
  assert.match(voiceHtml, /no microphone is needed for Learn Mode/);
  assert.match(voiceHtml, /function normalizeVoiceLearnDemonstrations/);
  assert.match(voiceHtml, /function getActiveVoiceLearnDemo/);
  assert.match(voiceHtml, /function resolveVoiceLearnAudioSrc/);
  assert.match(voiceHtml, /function activateVoiceLearnCuePoints/);
  assert.match(voiceHtml, /cuePoint\.momentId/);
  assert.match(voiceHtml, /runtimeSystemWalkthrough\?\.moments/);
  assert.match(voiceHtml, /setActiveSystemScreen\(moment\.screenId/);
  assert.match(voiceHtml, /function completeVoiceLearnDemo\(\)/);

  const startBlock = voiceHtml.slice(voiceHtml.indexOf("async function start()"), voiceHtml.indexOf("async function endCall()"));
  assert.match(startBlock, /if \(isVoiceLearnMode\(\)\)/);
  assert.match(startBlock, /startVoiceLearnDemo\(\)/);
  assert.doesNotMatch(startBlock, /navigator\.mediaDevices\.getUserMedia[\s\S]*if \(isVoiceLearnMode\(\)\)/);

  const learnBlock = voiceHtml.slice(voiceHtml.indexOf("function startVoiceLearnDemo"), voiceHtml.indexOf("function renderVoiceInstructions"));
  assert.doesNotMatch(learnBlock, /fetchEvaluationUntilSuccess|saveCoachingRecord|SESSION_URL|navigator\.mediaDevices/);
});

test("System Tools keeps learner hotspots invisible while preserving click targets", () => {
  assert.doesNotMatch(chatHtml, /clicking highlighted areas before responding/);
  assert.doesNotMatch(chatHtml, /\.system-tools-instruction/);
  assert.match(chatHtml, /\.system-hotspot-selected/);
  assert.match(chatHtml, /data-hotspot-type/);
  assert.match(chatHtml, /data-hotspot-id/);
  assert.match(chatHtml, /system-hotspot-\$\{getSystemHotspotType\(hotspot\)\}/);

  const hotspotRule = cssRule(".system-hotspot");
  assert.match(hotspotRule, /background:\s*transparent/);
  assert.match(hotspotRule, /pointer-events:\s*auto/);
  assert.match(hotspotRule, /border:\s*0/);

  const screenBlock = scriptBlock("setActiveSystemScreen", "handleSystemHotspotClick");
  assert.match(screenBlock, /clearSelectedSystemHotspot/);
  assert.match(screenBlock, /clearSystemFactSelection/);
  assert.match(screenBlock, /system-hotspot-\$\{getSystemHotspotType\(hotspot\)\}/);

  const clickBlock = scriptBlock("handleSystemHotspotClick", "showSystemFact");
  assert.match(clickBlock, /selectSystemHotspot\(hotspot\.id\)/);
  assert.match(clickBlock, /if \(hotspot\.fact\)/);
  assert.match(clickBlock, /showSystemFact\(hotspot\.fact\)/);

  const clearBlock = scriptBlock("clearSystemFactSelection", "showSystemFact");
  assert.match(clearBlock, /Select an area/);
  assert.match(clearBlock, /Use System Tools to review the supporting fact or move to another screen\./);
});

test("Learn guide schema supports modal and tooltip overlays", () => {
  const normalizeBlock = scriptBlock("normalizeSystemWalkthrough", "resolveWalkthroughAssetSrc");
  assert.match(normalizeBlock, /normalizeSystemGuide/);
  const guideNormalizeBlock = scriptBlock("normalizeSystemGuide", "normalizeSystemWalkthrough");
  assert.match(guideNormalizeBlock, /type:\s*normalizeSystemGuideType/);
  assert.match(guideNormalizeBlock, /buttonLabel:\s*String\(guide\.buttonLabel/);
  assert.match(guideNormalizeBlock, /placement:\s*normalizeSystemGuidePlacement/);
  assert.match(guideNormalizeBlock, /nextScreenId:\s*String\(guide\.nextScreenId/);
  assert.match(guideNormalizeBlock, /spotlightHotspotId/);
  assert.match(guideNormalizeBlock, /showBackdrop:\s*guide\.showBackdrop !== false/);
  assert.match(guideNormalizeBlock, /showSpotlight:\s*guide\.showSpotlight !== false/);
  assert.match(guideNormalizeBlock, /showBeacon:\s*guide\.showBeacon !== false/);

  const modalRule = cssRule(".system-guide-modal");
  assert.match(modalRule, /background:\s*#ffffff/);

  const tooltipRule = cssRule(".system-guide-tooltip");
  assert.match(tooltipRule, /background:\s*#002956/);

  const tooltipTitleRule = cssRule(".system-guide-tooltip .system-guide-title");
  assert.match(tooltipTitleRule, /color:\s*#ffffff/);

  const tooltipBodyRule = cssRule(".system-guide-tooltip .system-guide-body");
  assert.match(tooltipBodyRule, /color:\s*#ffffff/);

  assert.match(chatHtml, /id="walkthroughGuideLayer"/);
  assert.match(chatHtml, /\.system-guide-backdrop/);
  assert.match(chatHtml, /\.system-guide-spotlight/);
  assert.match(chatHtml, /\.system-guide-beacon/);
  assert.match(chatHtml, /#E80060/);
  assert.match(chatHtml, /#E3B63D/);
});

test("Learn guide navigation supports Next, Back, hotspot advance, and step counts", () => {
  const screenBlock = scriptBlock("setActiveSystemScreen", "handleSystemHotspotClick");
  assert.match(screenBlock, /renderSystemGuide\(screen\)/);
  assert.match(screenBlock, /data-hotspot-action/);
  assert.match(screenBlock, /hotspot\.action/);

  const clickBlock = scriptBlock("handleSystemHotspotClick", "getSystemHotspotType");
  assert.match(clickBlock, /hotspot\.action === "advance"/);
  assert.match(clickBlock, /advanceSystemGuide\(hotspot\.targetScreenId\)/);

  const advanceBlock = scriptBlock("advanceSystemGuide", "goBackSystemGuide");
  assert.match(advanceBlock, /resolveNextScreenId/);
  assert.match(advanceBlock, /setActiveSystemScreen/);

  const backBlock = scriptBlock("goBackSystemGuide", "resolveNextScreenId");
  assert.match(backBlock, /getActiveSystemScreenIndex/);
  assert.match(backBlock, /setActiveSystemScreen/);

  const guideBlock = scriptBlock("renderSystemGuide", "clearSystemGuide");
  assert.match(guideBlock, /system-guide-step-count/);
  assert.match(guideBlock, /systemGuideNextBtn/);
  assert.match(guideBlock, /systemGuideBackBtn/);
  assert.match(guideBlock, /addEventListener\("click", \(\) => advanceSystemGuide/);
  assert.match(guideBlock, /addEventListener\("click", goBackSystemGuide/);
});

test("scenario template uses experienceMode with content-only System Tools walkthrough", () => {
  assert.strictEqual(scenarioTemplate.experienceMode, "apply");
  const walkthrough = scenarioTemplate.frontend.chat.systemWalkthrough;
  assert.ok(walkthrough, "scenario-template should include frontend.chat.systemWalkthrough");
  assert.strictEqual(walkthrough.mode, undefined, "System Tools content should not define learner mode");
  assert.ok(Array.isArray(walkthrough.screens), "systemWalkthrough.screens should be an array");
  assert.ok(Array.isArray(walkthrough.moments), "systemWalkthrough.moments should be an array");
  assert.ok(walkthrough.moments.some((moment) => moment.trigger === "ideal_step_started"), "moments should describe authored content timing");
  assert.strictEqual(scenarioTemplate.frontend.chat.systemTools, undefined);

  const guides = walkthrough.screens.map((screen) => screen.guide).filter(Boolean);
  assert.ok(guides.some((guide) => guide.type === "modal"), "guided example should include a modal guide");
  assert.ok(guides.some((guide) => guide.type === "tooltip"), "guided example should include a tooltip guide");

  const tooltipScreen = walkthrough.screens.find((screen) => screen.guide?.type === "tooltip");
  assert.ok(tooltipScreen, "guided example should include a tooltip screen");
  assert.ok(tooltipScreen.guide.spotlightHotspotId, "tooltip example should name spotlightHotspotId");
  assert.ok(tooltipScreen.hotspots.some((hotspot) => hotspot.action === "advance"), "tooltip example should include advance hotspot");
});

test("Coach Chewy prefers coachSteps, falls back to guideSections, and renders inline tips after customer messages", () => {
  const applyBlock = scriptBlock("applyScenarioDisplayConfig", "loadScenarioDisplayConfig");
  assert.match(applyBlock, /frontend\?\.chat\?\.coachSteps/);
  assert.match(applyBlock, /frontend\?\.chat\?\.guideSections/);

  const inlineRule = cssRule(".coach-tip-row");
  assert.match(inlineRule, /align-self:\s*flex-start/);
  assert.match(inlineRule, /max-width:\s*82%/);

  const tipRule = cssRule(".coach-tip-card");
  assert.match(tipRule, /background:\s*#fffbeb/);
  assert.match(tipRule, /border:\s*1px solid #fde68a/);

  const renderBlock = scriptBlock("renderCoachSteps", "renderCoachProgress");
  assert.match(renderBlock, /runtimeCoachSteps = Array\.isArray\(steps\) \? steps : \[\]/);
  assert.doesNotMatch(renderBlock, /coach-step-list/);
  assert.doesNotMatch(renderBlock, /runtimeCoachSteps\s*\.map/);

  const tipBlock = scriptBlock("appendInlineCoachTip", "selectInlineCoachStep");
  assert.match(tipBlock, /Coach Chewy Tip/);
  assert.match(tipBlock, /coach-tip-title/);
  assert.match(tipBlock, /coach-tip-bullets/);

  const sendBlock = scriptBlock("sendMessage", "getCustomerReply");
  assert.match(sendBlock, /appendMessage\("assistant", replyTurn\.content, replyTurn\.label, replyTurn\.meta,\s*true,\s*selectInlineCoachStep/);
  assert.doesNotMatch(sendBlock, /renderCoachProgress\(\)/);
});

test("coaching save payload persists systemWalkthroughEvents without changing chat controls", () => {
  const payloadBlock = scriptBlock("buildReportingPayload", "fetchJSON");
  assert.match(payloadBlock, /systemWalkthroughEvents/);

  assert.match(chatHtml, /sendBtn\.addEventListener\("click", sendMessage\)/);
  assert.match(chatHtml, /confirmEndBtn\.addEventListener\("click", completeEndChat\)/);
  assert.match(chatHtml, /event\.key === "F8"/);
});

runTests();
