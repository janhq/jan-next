---
description: "Inline camera and microphone permission, capture, review and sharing in chat."
kind: "package-reference"
---

# @janhq/jan-client-ui-media-capture

## Summary

Review a requested camera photo, silent video, or microphone clip without leaving chat. The card shows why the agent asked and requests device access only after you choose Allow and the Host confirms the request is still active. You can annotate a photo, add a note to a recording, retake it, send it, or choose Not now to decline. Nothing is uploaded until you send it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

A running `capture_camera` or `capture_audio` call opens the capture card directly in chat. The preview stays in the browser. Not now discards unsent media and declines the request; closing the card releases its device tracks, including streams from a permission prompt that resolves late.

-----

## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The [capture card](src/client/CaptureCard.tsx) owns device access and draft media. The [pending-call callbacks](src/client/pending.ts) check that the call is still active before opening a device and send or decline it through the authenticated application transport.

</details>

-----

## Model Experience

### Capture submission

#### What the model sees

The card adds no model context of its own. Sending media or choosing Not now settles the pending `capture_camera` or `capture_audio` call; [the capture tool](../../interaction/tool-capture-media/README.md#model-experience) defines the result.

#### Token effect

No direct token cost. Device activity and drafts do not enter model requests.

#### KV Cache effect

The card has no direct effect on model requests or cache reuse.

## Known Limitations and Deferred Work

- A camera capture records silent video. Use the separate microphone capture for sound. Browser device availability and supported recording formats depend on the operating system and browser.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
