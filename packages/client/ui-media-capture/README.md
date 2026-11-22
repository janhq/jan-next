---
description: "Inline camera and microphone permission, capture, review and sharing in chat."
kind: "package-reference"
---

# @janhq/jan-client-ui-media-capture

A running `capture_camera` or `capture_audio` call opens a card directly in chat. The card shows the model's reason. It does not request a device until the user chooses Allow and the Host confirms the call still waits. Taking a picture or recording a clip creates a local preview, not an upload. The user can review the capture, annotate a photo or add a note to a recording, retake it, or send it. Not now declines and discards anything not shared. Closing the card releases its tracks, including streams obtained from a permission prompt that resolves late.

`CaptureCardProps` supplies `mode`, `reason`, `confirmActive`, `decline`, `send`, and the `mediaCapture` locale translator. The card owns device access, draft media, and their lifetime. `confirmActive` validates the active call without opening it; `send` and `decline` settle it through the authenticated application transport.

## Model Experience

Indirectly, through [`jan-tool-capture-media`](../../interaction/tool-capture-media/README.md), whose result contains only the shared capture or an explicit refusal.

#### KV Cache effect

The card has no direct effect on model requests or cache reuse.

## Known Limitations and Deferred Work

- A camera capture records silent video. Use the separate microphone capture for sound. Browser device availability and supported recording formats depend on the operating system and browser.
