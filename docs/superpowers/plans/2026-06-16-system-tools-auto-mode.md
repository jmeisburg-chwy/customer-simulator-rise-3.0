# System Tools Auto Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Auto Mode to the existing System Tools walkthrough so screenshots advance automatically after passed chat steps while preserving the guided hotspot walkthrough.

**Architecture:** Keep `frontend.chat.systemWalkthrough` as the only System Tools scenario contract. Extend the existing chat HTML normalizer and renderer to understand `mode` and `moments`, add a small auto-advance helper that reuses `setActiveSystemScreen()`, and call it only when `stepPassed === true`. Preserve the current guided-mode code path for omitted mode and `mode: "guided"`.

**Tech Stack:** Single-file HTML/JavaScript runtime, scenario JSON, Node.js built-in test scripts, existing string/contract tests in `tests/chat-ui-layout.test.js`.

---

## File Structure

- Modify `tests/chat-ui-layout.test.js`: add regression tests for Auto Mode normalization, passed-step advancement, off-path non-advancement, and guided-mode preservation.
- Modify `ArticulateRise-ChatExperience.html`: add `mode` and `moments` normalization, Auto Mode helpers, and a `sendMessage()` hook after successful customer replies.
- Modify `scenario-template.json`: document both Auto Mode and Guided Mode examples under the existing `frontend.chat.systemWalkthrough` contract.
- Modify `scenarios/late_delivery_20_partial_refund_chat.json`: convert the current pilot scenario to `mode: "auto"` and add initial `moments` for the available screenshots.

---

### Task 1: Add Auto Mode Contract Tests

**Files:**
- Modify: `tests/chat-ui-layout.test.js`
- Read: `ArticulateRise-ChatExperience.html`

- [ ] **Step 1: Add tests for mode and moments normalization**

Add this test after the existing `"System Tools uses systemWalkthrough screens, image assetKey, hotspots, facts, and navigation"` test:

```js
test("System Tools normalizes auto mode moments without creating a new contract", () => {
  assert.match(chatHtml, /function normalizeSystemWalkthroughMode\(value\)/);
  assert.match(chatHtml, /function normalizeSystemWalkthroughMoments\(moments, screens\)/);
  assert.match(chatHtml, /mode:\s*normalizeSystemWalkthroughMode\(walkthrough\.mode\)/);
  assert.match(chatHtml, /moments:\s*normalizeSystemWalkthroughMoments\(walkthrough\.moments, screens\)/);
  assert.match(chatHtml, /trigger:\s*normalizeSystemWalkthroughTrigger\(moment\.trigger\)/);
  assert.doesNotMatch(chatHtml, /frontend\?\.chat\?\.systemTools|frontend\.chat\.systemTools|systemTools:/);
});
```

- [ ] **Step 2: Add tests for passed-step advancement and off-path non-advancement**

Add this test after the new normalization test:

```js
test("System Tools auto mode advances only after a passed chat step", () => {
  assert.match(chatHtml, /function isAutoSystemWalkthrough\(\)/);
  assert.match(chatHtml, /function getAutoSystemScreenIdForStep\(stepId, trigger = "chat_step_passed"\)/);
  assert.match(chatHtml, /function advanceSystemWalkthroughForChatStep\(stepId, options = \{\}\)/);

  const advanceBlock = scriptBlock("advanceSystemWalkthroughForChatStep", "function renderSystemWalkthrough");
  assert.match(advanceBlock, /isAutoSystemWalkthrough\(\)/);
  assert.match(advanceBlock, /getAutoSystemScreenIdForStep\(stepId/);
  assert.match(advanceBlock, /setActiveSystemScreen\(screenId/);
  assert.match(advanceBlock, /type:\s*"auto_screen"/);

  const sendBlock = scriptBlock("sendMessage", "getCustomerReply");
  assert.match(sendBlock, /if \(stepPassed\) \{/);
  assert.match(sendBlock, /advanceSystemWalkthroughForChatStep\(nextStep/);
  assert.doesNotMatch(sendBlock, /advanceSystemWalkthroughForChatStep\(responseStep/);
});
```

- [ ] **Step 3: Add a template test for Auto and Guided examples**

Replace the current test named `"scenario template includes Learn modal and tooltip guide examples"` with:

```js
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
  const guides = guidedExample.screens.map((screen) => screen.guide).filter(Boolean);
  assert.ok(guides.some((guide) => guide.type === "modal"), "guided example should include a modal guide");
  assert.ok(guides.some((guide) => guide.type === "tooltip"), "guided example should include a tooltip guide");
  const tooltipScreen = guidedExample.screens.find((screen) => screen.guide?.type === "tooltip");
  assert.ok(tooltipScreen.guide.spotlightHotspotId, "tooltip example should name spotlightHotspotId");
  assert.ok(tooltipScreen.hotspots.some((hotspot) => hotspot.action === "advance"), "tooltip example should include advance hotspot");
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `node tests/chat-ui-layout.test.js`

Expected: FAIL because Auto Mode helper functions, normalized `moments`, and the template example have not been implemented yet.

---

### Task 2: Normalize Mode And Moments In The Existing Renderer

**Files:**
- Modify: `ArticulateRise-ChatExperience.html`
- Test: `tests/chat-ui-layout.test.js`

- [ ] **Step 1: Add mode and trigger normalization functions**

Add these functions before `normalizeSystemGuideType(value)`:

```js
    function normalizeSystemWalkthroughMode(value) {
      const mode = String(value || "").trim().toLowerCase();
      return mode === "auto" ? "auto" : "guided";
    }

    function normalizeSystemWalkthroughTrigger(value) {
      const trigger = String(value || "").trim().toLowerCase();
      return trigger === "chat_step_passed" ? "chat_step_passed" : "chat_step_passed";
    }
```

- [ ] **Step 2: Add moment normalization after `normalizeSystemGuide(guide)`**

```js
    function normalizeSystemWalkthroughMoments(moments, screens) {
      if (!Array.isArray(moments)) return [];
      const screenIds = new Set((Array.isArray(screens) ? screens : []).map((screen) => screen.id));
      return moments
        .map((moment) => {
          if (!moment || typeof moment !== "object") return null;
          const stepId = Number(moment.stepId ?? moment.step ?? moment.currentStep);
          const screenId = String(moment.screenId || moment.targetScreenId || "").trim();
          if (!Number.isFinite(stepId) || !screenId || !screenIds.has(screenId)) return null;
          return {
            stepId,
            screenId,
            trigger: normalizeSystemWalkthroughTrigger(moment.trigger)
          };
        })
        .filter(Boolean);
    }
```

- [ ] **Step 3: Return `mode` and `moments` from `normalizeSystemWalkthrough(walkthrough)`**

Replace the final return in `normalizeSystemWalkthrough(walkthrough)`:

```js
      return screens.length ? { screens } : null;
```

with:

```js
      return screens.length
        ? {
            mode: normalizeSystemWalkthroughMode(walkthrough.mode),
            screens,
            moments: normalizeSystemWalkthroughMoments(walkthrough.moments, screens)
          }
        : null;
```

- [ ] **Step 4: Run the UI layout tests**

Run: `node tests/chat-ui-layout.test.js`

Expected: the normalization assertions pass, while Auto Mode helper and template assertions still fail.

---

### Task 3: Add Auto Mode Advancement Helpers

**Files:**
- Modify: `ArticulateRise-ChatExperience.html`
- Test: `tests/chat-ui-layout.test.js`

- [ ] **Step 1: Add Auto Mode helpers before `renderSystemWalkthrough(walkthrough)`**

```js
    function isAutoSystemWalkthrough() {
      return runtimeSystemWalkthrough?.mode === "auto";
    }

    function getAutoSystemScreenIdForStep(stepId, trigger = "chat_step_passed") {
      if (!runtimeSystemWalkthrough?.moments?.length) return "";
      const numericStepId = Number(stepId);
      if (!Number.isFinite(numericStepId)) return "";
      const normalizedTrigger = normalizeSystemWalkthroughTrigger(trigger);
      const moment = runtimeSystemWalkthrough.moments.find((item) =>
        item.stepId === numericStepId && item.trigger === normalizedTrigger
      );
      return moment?.screenId || "";
    }

    function advanceSystemWalkthroughForChatStep(stepId, options = {}) {
      if (!isAutoSystemWalkthrough()) return;
      const screenId = getAutoSystemScreenIdForStep(stepId, "chat_step_passed");
      if (!screenId || screenId === activeSystemScreenId) return;
      setActiveSystemScreen(screenId);
      if (options.recordEvent !== false) {
        recordSystemWalkthroughEvent({
          type: "auto_screen",
          screenId,
          hotspotId: "",
          targetScreenId: screenId,
          factId: "",
          stepId: Number(stepId)
        });
      }
    }
```

- [ ] **Step 2: Hide guide overlays for Auto Mode while preserving guided code**

At the top of `renderSystemGuide(screen)`, replace:

```js
      if (!guide || !walkthroughGuideLayerEl) return;
```

with:

```js
      if (!guide || !walkthroughGuideLayerEl || isAutoSystemWalkthrough()) return;
```

This keeps existing guided `guide` objects dormant while Auto Mode is active.

- [ ] **Step 3: Disable manual hotspot click targets in Auto Mode**

In `setActiveSystemScreen(screenId, options = {})`, wrap the hotspot rendering loop with an Auto Mode guard:

```js
      walkthroughHotspotLayerEl.innerHTML = "";
      if (!isAutoSystemWalkthrough()) {
        screen.hotspots.forEach((hotspot) => {
          const button = document.createElement("button");
          const hotspotType = getSystemHotspotType(hotspot);
          button.type = "button";
          button.className = `system-hotspot system-hotspot-${getSystemHotspotType(hotspot)}`;
          button.setAttribute("aria-label", `${hotspot.label} (${getSystemHotspotActionLabel(hotspotType)})`);
          button.setAttribute("data-hotspot-id", hotspot.id);
          button.setAttribute("data-hotspot-type", hotspotType);
          button.setAttribute("data-hotspot-action", hotspot.action);
          applyHotspotPosition(button, hotspot);
          button.addEventListener("click", () => handleSystemHotspotClick(hotspot));
          walkthroughHotspotLayerEl.appendChild(button);
        });
      }
      renderSystemGuide(screen);
```

- [ ] **Step 4: Run the UI layout tests**

Run: `node tests/chat-ui-layout.test.js`

Expected: Auto helper assertions pass; send-message and template assertions still fail.

---

### Task 4: Advance Screens From Passed Chat Steps

**Files:**
- Modify: `ArticulateRise-ChatExperience.html`
- Test: `tests/chat-ui-layout.test.js`

- [ ] **Step 1: Call Auto Mode advancement only after a successful customer reply**

In `sendMessage()`, find this block:

```js
        transcript.push(replyTurn);
        appendMessage("assistant", replyTurn.content, replyTurn.label, replyTurn.meta, true, selectInlineCoachStep(replyTurn.content, nextStep));
        currentStep = nextStep;
```

Replace it with:

```js
        transcript.push(replyTurn);
        appendMessage("assistant", replyTurn.content, replyTurn.label, replyTurn.meta, true, selectInlineCoachStep(replyTurn.content, nextStep));
        if (stepPassed) {
          advanceSystemWalkthroughForChatStep(nextStep);
        }
        currentStep = nextStep;
```

This intentionally uses `nextStep`, not `responseStep`, so the new screenshot corresponds to the next work phase after the learner successfully completes the current phase.

- [ ] **Step 2: Run the UI layout tests**

Run: `node tests/chat-ui-layout.test.js`

Expected: all Auto Mode HTML assertions pass except any scenario-template assertions not yet implemented.

---

### Task 5: Update Scenario Template Examples

**Files:**
- Modify: `scenario-template.json`
- Test: `tests/chat-ui-layout.test.js`

- [ ] **Step 1: Convert `frontend.chat.systemWalkthrough` to the Auto Mode example**

In `scenario-template.json`, make `frontend.chat.systemWalkthrough` use this shape:

```json
"systemWalkthrough": {
  "mode": "auto",
  "screens": [
    {
      "id": "customer-search",
      "title": "Customer Search",
      "image": {
        "assetKey": "customer-search-screen",
        "src": "",
        "alt": "Customer search screen"
      },
      "hotspots": []
    },
    {
      "id": "order-detail",
      "title": "Order Detail",
      "image": {
        "assetKey": "order-detail-screen",
        "src": "",
        "alt": "Order detail screen"
      },
      "hotspots": []
    }
  ],
  "moments": [
    {
      "stepId": 0,
      "screenId": "customer-search",
      "trigger": "chat_step_passed"
    },
    {
      "stepId": 1,
      "screenId": "order-detail",
      "trigger": "chat_step_passed"
    }
  ]
}
```

- [ ] **Step 2: Preserve the current modal/tooltip walkthrough as a guided example**

Add a sibling field under `frontend.chat` named `guidedSystemWalkthroughExample` using the current modal/tooltip `screens` data:

```json
"guidedSystemWalkthroughExample": {
  "mode": "guided",
  "screens": [
    {
      "id": "learn-start",
      "title": "Learn Start",
      "image": {
        "assetKey": "learn-start-screen",
        "src": "",
        "alt": "System screen shown behind the Learn start modal"
      },
      "guide": {
        "type": "modal",
        "title": "Learn",
        "body": "Use this step for general information that does not need to point to a specific on-screen element.",
        "buttonLabel": "Start",
        "nextScreenId": "status-screen",
        "showBackdrop": true
      },
      "hotspots": []
    },
    {
      "id": "status-screen",
      "title": "Status",
      "image": {
        "assetKey": "status-screen",
        "src": "",
        "alt": "System screen with the target status area"
      },
      "guide": {
        "type": "tooltip",
        "title": "",
        "body": "Let's complete the incident and stay in Available for the next contact.",
        "buttonLabel": "Next",
        "placement": "left",
        "nextScreenId": "next-screen",
        "spotlightHotspotId": "status-dropdown",
        "showBeacon": true,
        "showBackdrop": true,
        "showSpotlight": true
      },
      "hotspots": [
        {
          "id": "status-dropdown",
          "label": "Available status dropdown",
          "x": 69,
          "y": 4,
          "width": 28,
          "height": 17,
          "action": "advance",
          "targetScreenId": "next-screen"
        }
      ]
    },
    {
      "id": "next-screen",
      "title": "Next System Screen",
      "image": {
        "assetKey": "next-system-screen",
        "src": "",
        "alt": "Next system screen"
      },
      "hotspots": []
    }
  ]
}
```

- [ ] **Step 3: Validate JSON and run UI tests**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("scenario-template.json", "utf8")); console.log("ok")'
node tests/chat-ui-layout.test.js
```

Expected: JSON parse prints `ok`; layout tests pass.

---

### Task 6: Convert The Pilot Scenario To Auto Mode

**Files:**
- Modify: `scenarios/late_delivery_20_partial_refund_chat.json`
- Test: `tests/behavior-framework.test.js`
- Test: `tests/chat-ui-layout.test.js`

- [ ] **Step 1: Add `mode: "auto"` to the current scenario walkthrough**

In `frontend.chat.systemWalkthrough`, change:

```json
"systemWalkthrough": {
  "screens": [
```

to:

```json
"systemWalkthrough": {
  "mode": "auto",
  "screens": [
```

- [ ] **Step 2: Add a conservative first moment for the existing screenshot**

After the `screens` array, add:

```json
  ],
  "moments": [
    {
      "stepId": 0,
      "screenId": "system-tools-1",
      "trigger": "chat_step_passed"
    }
  ]
```

If more screenshots are added later, extend `screens` and `moments` together.

- [ ] **Step 3: Validate scenario JSON and run tests**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("scenarios/late_delivery_20_partial_refund_chat.json", "utf8")); console.log("ok")'
node tests/chat-ui-layout.test.js
node tests/behavior-framework.test.js
```

Expected: JSON parse prints `ok`; both test suites pass.

---

### Task 7: Final Verification And Commit

**Files:**
- Check: `ArticulateRise-ChatExperience.html`
- Check: `tests/chat-ui-layout.test.js`
- Check: `scenario-template.json`
- Check: `scenarios/late_delivery_20_partial_refund_chat.json`
- Check: `docs/superpowers/plans/2026-06-16-system-tools-auto-mode.md`

- [ ] **Step 1: Run full local verification**

Run:

```bash
node --check Lambda.js
node tests/chat-ui-layout.test.js
node tests/behavior-framework.test.js
node tests/calibration/run-calibration.js
```

Expected: all commands pass.

- [ ] **Step 2: Inspect the final diff**

Run:

```bash
git diff -- ArticulateRise-ChatExperience.html tests/chat-ui-layout.test.js scenario-template.json scenarios/late_delivery_20_partial_refund_chat.json docs/superpowers/plans/2026-06-16-system-tools-auto-mode.md
```

Expected: diff only contains Auto Mode support, scenario/template examples, and the implementation plan.

- [ ] **Step 3: Commit and push**

Run:

```bash
git add ArticulateRise-ChatExperience.html tests/chat-ui-layout.test.js scenario-template.json scenarios/late_delivery_20_partial_refund_chat.json docs/superpowers/plans/2026-06-16-system-tools-auto-mode.md
git commit -m "Add System Tools auto mode"
git push system-tools codex/customer-simulator-system-tools
```

Expected: the existing draft PR updates with the Auto Mode implementation.

---

## Self-Review

- Spec coverage: this plan covers Auto Mode, preserves Guided Mode, keeps `frontend.chat.systemWalkthrough`, avoids `frontend.chat.systemTools`, advances only after `stepPassed === true`, avoids off-path advancement, and persists auto screen events.
- Placeholder scan: no task uses TBD/TODO/fill-in language; each step includes concrete files, code snippets, commands, and expected outcomes.
- Type consistency: the plan consistently uses `mode`, `screens`, `moments`, `stepId`, `screenId`, `trigger`, and `chat_step_passed`; the helper names are consistent across tests and implementation snippets.
