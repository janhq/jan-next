---
description: "Camera and microphone tools that ask the person in chat to share a reviewed capture."
kind: "package-reference"
---

# @janhq/jan-tool-capture-media

`capture_camera` takes `reason` and `mode` (`photo` or `video`); `capture_audio` takes `reason`. The default Web agent preset registers both for foreground chat sessions. The Web Host provider owns each waiting call by Session and tool call ID. Authenticated owner requests can check whether the call still waits, decline it, or stream the reviewed media into the attachment store. A cancelled tool no longer accepts submissions. The camera never opens the microphone; camera video is silent.

## Model Experience

### Tool results

#### What the model sees

A refusal states that the user declined and no media was shared. A photo produces image content. Audio and video produce a file reference, an agent-readable path and a user note when supplied. Live device data and unsent previews do not enter the tool result.

#### Token effect

Result text, attachment descriptors, and photo tokens are added only when the corresponding tool call settles.

#### KV Cache effect

The result is appended using the ordinary tool lifecycle; existing history is unchanged.

## Known Limitations and Deferred Work

- Audio and video are saved as files rather than sent as native model input. A model needs a tool that can interpret the recording format to analyze the bytes.
