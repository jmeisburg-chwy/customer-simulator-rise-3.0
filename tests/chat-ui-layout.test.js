const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const chatHtml = fs.readFileSync(path.join(repoRoot, "ArticulateRise-ChatExperience.html"), "utf8");
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

  const summaryRule = cssRule("html.full-preview .experience-card summary");
  assert.match(summaryRule, /display:\s*none/);

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
  assert.match(chatHtml, /chatAccordion\.open = true/);
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

test("System Tools normalizes auto mode moments without creating a new contract", () => {
  assert.match(chatHtml, /function normalizeSystemWalkthroughMode\(value\)/);
  assert.match(chatHtml, /function normalizeSystemWalkthroughMoments\(moments, screens\)/);
  assert.match(chatHtml, /mode:\s*normalizeSystemWalkthroughMode\(walkthrough\.mode\)/);
  assert.match(chatHtml, /moments:\s*normalizeSystemWalkthroughMoments\(walkthrough\.moments, screens\)/);
  assert.match(chatHtml, /trigger:\s*normalizeSystemWalkthroughTrigger\(moment\.trigger\)/);
  assert.doesNotMatch(chatHtml, /frontend\?\.chat\?\.systemTools|frontend\.chat\.systemTools|systemTools:/);
});

test("System Tools auto mode advances only after a passed chat step", () => {
  assert.match(chatHtml, /function isAutoSystemWalkthrough\(\)/);
  assert.match(chatHtml, /function getAutoSystemScreenIdForStep\(stepId, trigger = "chat_step_passed"\)/);
  assert.match(chatHtml, /function advanceSystemWalkthroughForChatStep\(stepId, options = \{\}\)/);

  const advanceBlock = scriptBlock("advanceSystemWalkthroughForChatStep", "renderSystemWalkthrough");
  assert.match(advanceBlock, /isAutoSystemWalkthrough\(\)/);
  assert.match(advanceBlock, /getAutoSystemScreenIdForStep\(stepId/);
  assert.match(advanceBlock, /setActiveSystemScreen\(screenId/);
  assert.match(advanceBlock, /type:\s*"auto_screen"/);

  const sendBlock = scriptBlock("sendMessage", "getCustomerReply");
  assert.match(
    sendBlock,
    /if \(stepPassed\) \{\s*advanceSystemWalkthroughForChatStep\(nextStep\);\s*\}\s*currentStep = nextStep;/
  );
  assert.doesNotMatch(sendBlock, /advanceSystemWalkthroughForChatStep\(responseStep/);
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

test("scenario template includes Auto and Guided System Tools examples", () => {
  const walkthrough = scenarioTemplate.frontend.chat.systemWalkthrough;
  assert.ok(walkthrough, "scenario-template should include frontend.chat.systemWalkthrough");
  assert.strictEqual(walkthrough.mode, "auto", "scenario-template should show auto mode as the near-term default");
  assert.ok(Array.isArray(walkthrough.screens), "systemWalkthrough.screens should be an array");
  assert.ok(Array.isArray(walkthrough.moments), "systemWalkthrough.moments should be an array");
  assert.ok(walkthrough.moments.some((moment) => moment.trigger === "chat_step_passed"), "auto example should include chat_step_passed moments");

  const guidedExample = scenarioTemplate.frontend.chat.guidedSystemWalkthroughExample;
  assert.ok(guidedExample, "scenario-template should preserve a guided walkthrough example");
  assert.strictEqual(guidedExample.mode, "guided");
  assert.ok(Array.isArray(guidedExample.screens), "guided example screens should be an array");
  const guides = guidedExample.screens.map((screen) => screen.guide).filter(Boolean);
  assert.ok(guides.some((guide) => guide.type === "modal"), "guided example should include a modal guide");
  assert.ok(guides.some((guide) => guide.type === "tooltip"), "guided example should include a tooltip guide");

  const tooltipScreen = guidedExample.screens.find((screen) => screen.guide?.type === "tooltip");
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
