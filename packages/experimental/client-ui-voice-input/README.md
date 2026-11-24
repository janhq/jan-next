---
description: "Record speech and insert reviewable transcripts into the conversation draft."
kind: "package-reference"
---

# @janhq/jan-experimental-client-ui-voice-input

## Summary

Jan Desktop shows a microphone next to Send, including before a chat exists or Voice Input is enabled. Its first-use dialog chooses a language and prepares local models. After setup, clicking the mic opens a recording toolbar with measured input levels, Cancel and Stop. Stopping transcribes into the draft without submitting it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Click the microphone, choose a recognition language, and click **Download and prepare** when the model is not already cached. The dialog shows progress and offers retry if preparation fails. Click **Enable and start recording** to enable the [Voice Input bundle](../voice-input-bundle/README.md) and begin recording. Cancel or Escape leaves the bundle and preferences unchanged; verified files can be reused. Subsequent clicks record immediately. Click **Stop and transcribe** to insert into the draft or cancel to discard the capture. Browser microphone access requires HTTPS or loopback and operating-system permission. Voice options beside the mic can offer alternate modes such as Talk to Jan.

Use the native **Input device** selector in bundle details to follow the system default or select a browser microphone. System default shows the current device name when available. While bundle details are active, the selected input's live level remains visible at the right of the field; selecting another input restarts the preview for that device. Hiding or leaving the page, or disabling the plugin, releases the preview, including late permission grants. The browser remembers the device for subsequent recordings independently of Host recognition settings. Device insertion and removal refresh the options without interrupting an available selected input. A disconnected selection retains its name and position as a disabled option with an Unavailable label. Reconnecting while the page is active restores its preview; choosing another input removes the unavailable option. Interrupted recordings require an explicit restart. Permission denial keeps other choices accessible; an explicitly selected device never silently falls back to another input.

Before downloading or retrying, **Model download source** offers Automatic and the origins advertised by the Host. SenseVoice normally offers Hugging Face and HF-Mirror; a fixed private deployment exposes only its configured origin. Manual selection uses only that source, while Automatic preserves the provider’s comparison and fallback policy. The choice is retained for retries in the current card, without changing deployment configuration or recognition preferences. Source controls are unavailable during preparation and hidden when resources are ready.

You can also enable Voice Input from Plugins and prepare the models from its details. `pluginNavigation` is optional: the plugin starts without it, and the Plugins-page activation prompt only offers its details action while navigation is available.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Native MediaRecorder captures audio and Web Audio converts it to the Host PCM format after flushing the final recorder chunks. Input-level previews use Web Audio without creating a MediaRecorder. Window blur during the microphone permission request does not cancel capture; blur during recording does. Capture failures immediately end the recording UI and offer retry inside the toolbar. Cancellation, failure and plugin disposal share one resource-release promise; the plugin retains ownership until AudioContext closure settles. The original editor selection carries a draft revision: changed drafts retain the transcript for explicit insertion or discard beside the microphone. Session changes, hiding the page during capture and plugin disposal invalidate late results and release tracks. One plugin-owned readiness subscription serves the composer, installation prompt and details. These views use the existing Slot lifecycle and own no preparation tasks.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as recordings and preparation remain outside model requests; ordinary user submission owns any later text.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No automatic send, always-on microphone, wake word, streaming captions or speech synthesis. “Local” means the Host machine, which can differ from the browser’s machine.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
