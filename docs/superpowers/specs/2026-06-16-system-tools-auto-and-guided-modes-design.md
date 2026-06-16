# System Tools Auto And Guided Modes Design

## Purpose

The System Tools pane should support two training patterns without splitting into separate apps or separate scenario contracts.

The immediate product need is an automatic screenshot mode: the learner should see the right system screenshot at the right moment in the conversation without manually navigating System Tools. This reduces cognitive load while the learner focuses on the customer response.

The guided walkthrough work already built on this branch should be preserved as a future mode: scenario authors can define hotspots, tooltip or modal guidance, and manual navigation when the learning objective is system navigation rather than conversation support.

## Current State To Preserve

The current branch already has valuable guided-mode capabilities:

- `frontend.chat.systemWalkthrough.screens` is the approved scenario contract.
- Each screen can define an image with `src` or `assetKey`.
- Screens can include `hotspots`.
- Screens can include `guide` objects for modal or tooltip overlays.
- Hotspot clicks can reveal facts, navigate to another screen, or advance guide steps.
- `systemWalkthroughEvents` are captured and sent with the coaching save payload.
- Tests in `tests/chat-ui-layout.test.js` protect the current guided-mode renderer and explicitly prevent introducing `frontend.chat.systemTools`.

This work should not be moved to another app or deleted. It should remain dormant or optional when Auto Mode is active.

## Scenario Contract

Keep the existing contract:

```json
{
  "frontend": {
    "chat": {
      "systemWalkthrough": {
        "mode": "auto",
        "screens": [],
        "moments": []
      }
    }
  }
}
```

Do not introduce `frontend.chat.systemTools`. "System Tools" remains the UI label; `systemWalkthrough` remains the data contract.

## Mode 1: Auto Screens

Auto Mode is the near-term default for roleplay support.

In Auto Mode:

- The first screen appears when the chat loads.
- The System Tools screenshot advances automatically when the learner passes a configured chat step.
- The learner does not need to click hotspots or walkthrough controls.
- If the learner goes off-path and does not pass the current step, the System Tools screenshot stays on the current screen.
- Coach Chewy tips and System Tools screenshots should feel synchronized because both can key off the same chat step progression.

Example:

```json
{
  "systemWalkthrough": {
    "mode": "auto",
    "screens": [
      {
        "id": "customer-search",
        "title": "Customer Search",
        "image": {
          "src": "assets/system-tools/1.png",
          "alt": "Customer Search screen"
        }
      },
      {
        "id": "order-detail",
        "title": "Order Detail",
        "image": {
          "src": "assets/system-tools/2.png",
          "alt": "Order Detail screen"
        }
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
}
```

If `mode` is omitted, the renderer should behave like today's guided/manual mode for backward compatibility.

## Mode 2: Guided Walkthrough

Guided Mode is preserved for deeper system-navigation training.

In Guided Mode:

- Scenario authors can define hotspots and guide overlays.
- Learners manually click through areas of the screenshot.
- Tooltips, modals, spotlights, and beacon effects remain available.
- Hotspot events continue to be captured in `systemWalkthroughEvents`.

Example:

```json
{
  "systemWalkthrough": {
    "mode": "guided",
    "screens": [
      {
        "id": "refund-options",
        "title": "Refund Options",
        "image": {
          "assetKey": "refund-options-screen",
          "alt": "Refund Options screen"
        },
        "guide": {
          "type": "tooltip",
          "body": "Use this area to confirm where the partial refund should be applied.",
          "spotlightHotspotId": "refund-method"
        },
        "hotspots": [
          {
            "id": "refund-method",
            "label": "Refund method",
            "x": 58,
            "y": 42,
            "width": 16,
            "height": 8,
            "action": "fact",
            "fact": {
              "id": "refund-destination",
              "title": "Refund Destination",
              "body": "The learner should offer original payment method and Chewy account credit."
            }
          }
        ]
      }
    ]
  }
}
```

## Mode 3: Hybrid Later

A later hybrid mode can combine both behaviors:

- Screens auto-advance on passed chat steps.
- Optional hotspots are available for learners who want supporting facts.
- Manual hotspot interaction is not required to progress the conversation.

Hybrid should only be added after Auto Mode is working and tested.

## Data Flow

1. Lambda returns `frontend.chat.systemWalkthrough` through the existing scenario client config.
2. Chat HTML normalizes the walkthrough.
3. On chat start, the renderer shows the first configured screen.
4. When a learner sends a message, the existing `evaluateCurrentStep()` result determines `stepPassed`.
5. If `stepPassed` is true and the walkthrough is in Auto Mode, the renderer finds the `moments` entry for the next step and calls the existing screen-rendering path.
6. If `stepPassed` is false, the current screen remains visible.
7. Guided Mode continues using the existing hotspot and guide handlers.
8. Auto screen changes may be recorded in `systemWalkthroughEvents` with a new event type such as `auto_screen`.

## Authoring Guidance

For the immediate scenario authoring path, prefer Auto Mode:

- Use one screenshot per meaningful conversation phase.
- Map screenshots to chat progression step ids.
- Avoid hotspots unless the learning objective requires system navigation.
- Keep the screenshot title plain and operational, such as "Customer Search" or "Refund Options."

Use Guided Mode when the learner must learn where to click, what field to inspect, or how to move through a system flow.

## Testing

Add or preserve tests for:

- `frontend.chat.systemWalkthrough` remains the only System Tools scenario contract.
- Auto Mode changes screens only after `stepPassed === true`.
- Auto Mode does not reveal future screenshots when the learner is off-path.
- Guided Mode hotspots, tooltips, modals, and navigation still render.
- `systemWalkthroughEvents` includes guided click events and auto screen-change events.

## Non-Goals

- No new `frontend.chat.systemTools` schema.
- No separate app or fork for Auto Mode.
- No removal of guided walkthrough code.
- No requirement that all scenarios use hotspots.
- No dependency on live system automation; screenshots remain authored assets.

## Open Product Choice

The recommended default is:

- `mode: "auto"` for the current System Tools roleplay pilot.
- `mode: "guided"` only when a scenario intentionally teaches system navigation.

If a scenario omits `mode`, the current renderer should continue behaving like guided/manual mode to avoid breaking existing scenario templates.
