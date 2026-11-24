# Agent Note: Local models read images through vision projectors

Status: implemented

## Problem

The [bundled worker](../architecture/2026-11-13-bundled-llama-worker.md) served text only: the `llama-cpp` plugin refused multimodal projector (`mmproj`) files and wrote no projector into the preset. A vision-language GGUF model reads images only when llama.cpp loads it with its projector, so image attachments could not reach any local model, while Jan serves the same models with images.

## Decision

A projector belongs to one installed model. `ModelRecord.mmproj` in `install.json` records its file, size, SHA-256 digest when downloaded, and a `vision` flag; the record stays version 3 because the field is optional and a record without it describes a text-only model. A projector file must have `general.architecture = clip`, and `vision` follows `clip.has_vision_encoder`, or, without that key, is true unless `clip.has_audio_encoder` is true, as in Jan. A `clip` file is still refused as the model file.

Projector selection follows Jan. A Hugging Face download also downloads the repository's projector, `mmproj-f16.gguf` in any letter case, otherwise the first `mmproj` file listed, with no option to skip it; curated entries pin their projector next to the model file. Downloaded projectors are verified and stored at `models/<id>/mmproj-<sha256 prefix>.gguf`; imported projectors stay in place. The preset writes `mmproj = <path>` in the model's section and `mmproj-offload = false` when `mmprojOffload` is false.

The route entry of each model declares `input: ['text', 'image']` only when its projector has `vision`, otherwise `['text']`, so `llm-pi-ai` accepts or rejects an image attachment before the request leaves; accepted images reach the worker as OpenAI `image_url` data URLs. At boot, a projector that is missing or has changed size is dropped from its model with a warning, and the model stays listed as text-only.

## Alternatives considered

**Install projectors as separate entries with a picker.** It lets a user choose a quantization of the projector, but most users cannot judge the choice, and Jan pairs the projector automatically. Without a picker, the selection rule is fixed.

**Offer the projector download as an option.** It saves the projector's size for a text-only user, but adds a choice to every Hugging Face download that Jan does not ask; a text-only user can download from a repository without a projector.

**Declare image input for every local model.** The route would need no projector facts, but a text-only model would receive images and fail mid-turn in the worker instead of the attachment being refused before sending.

**Drop the whole model when its projector is missing.** It keeps the record consistent with the original download, but removes a model that still serves text.

**Bump `install.json` to version 4.** No existing field changes meaning, and a reader that sees no `mmproj` serves text, so a version change would only block downgrade without preventing a misreading.

## Consequences

Users can attach images to local vision models, and the picker, fit estimates and displayed sizes account for the projector. A Hugging Face download from a repository with a projector always costs the projector's disk and memory. An imported projector is not checked against its model; a mismatch appears as a load failure. Audio-only projectors are recorded with `vision` false and add no input type. `mmprojOffload` applies to every model.
