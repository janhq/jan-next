# @janhq/jan-tokamak

Tokamak's media and voice APIs in Jan: image generation and editing, text to speech, transcription, Read aloud on replies, voice conversations and System One classification. Chat, `tokamak/auto` routing and web search and fetch already use Tokamak through the `tokamak` model route and `@janhq/jan-web-search`; Settings > Account shows the balance.

## Use this plugin

The desktop bundle mounts it as the `jan-tokamak` row, together with the composer microphone (`speech-to-text`, `api-speech-to-text`, `ui-voice-input`) set to dictate through Tokamak.

| You do | What happens | Tokamak endpoint |
|---|---|---|
| Ask for a picture, or a change to an image in the folder | `generate_image` / `edit_image` save it under `images/` and the agent presents it | `POST /images/generations`, `POST /images/edits` |
| Ask for a voice-over or an audio version of text | `text_to_speech` saves a WAV under `audio/` | `POST /audio/speech` |
| Ask for the text of a recording in the folder | `transcribe_audio` returns the transcript | `POST /audio/transcriptions` |
| Choose Tokamak as the recognition service in Voice Input and dictate | the recording is transcribed into the draft | `POST /audio/transcriptions` |
| Press Read aloud under a reply | the reply is read in parts of up to 3,800 characters, the next part fetched while one plays | `POST /audio/speech` |
| Open Voice options beside the mic and choose Talk to Jan | a WebRTC voice conversation; on End, what both sides said is added to the draft | `POST /realtime/client_secrets`, `POST /realtime/calls` |
| Ask for triage, routing or a score | `classify` returns calibrated answers | `POST /systemone` |

| Field | Default | Meaning |
|---|---|---|
| `apiBaseURL` | `TOKAMAK_BASE_URL`, else `https://api.tokamak.sh/v1` | Tokamak API root; a bare origin gets `/v1` |
| `model` | `openai/gpt-image-2` | Image model |
| `timeoutMs` | `180000` | Longest wait for one image request |
| `transcriptionModel` | `openai/gpt-transcribe` | Transcription model, also used inside voice conversations |
| `realtimeModel` | `openai/gpt-realtime-2.1-mini` | Voice conversation model |
| `jevModel` | `jev/jev-latest` | System One model |
| `speechProvider` | `true` | Register `tokamak` as a dictation provider when the speech service is mounted |

Requests use the signed-in Tokamak account's key, then the `TOKAMAK_API_KEY` credential. Without either, the tool tells the user to sign in to Tokamak in Settings > Account. A key the server rejects with HTTP 401 signs the account out, as web search does. The browser half never sees the key: Read aloud goes through `POST /jan-api/tokamak`, and a voice conversation gets a one-time `tkrt_` token that opens one call and expires within 60 seconds.

Refusals a user can act on are reworded: an organization whose guardrail policy cannot screen audio (`guardrail_policy_unsupported`) is told an admin can allow unscreened voice, `402` names the balance, and `speech_unverified` asks for plainer text.

## Model Experience

Five tools are registered. Chat mode hides `edit_image` and `transcribe_audio` because they read local files.

- `generate_image({ prompt, path?, size?, quality?, background?, n? })` and `edit_image({ prompt, images, mask?, path?, size?, quality?, background?, n? })`. `size` is `auto`, `1024x1024`, `1536x1024` or `1024x1536`; `quality` `auto`, `low`, `medium` or `high`; `background` `auto`, `transparent` or `opaque`; `n` 1 to 4. When the calling model reads images, the images are attached to the result so it can check them.
- `text_to_speech({ text, path?, voice?, instructions?, speed? })`: up to 4,096 characters, read word for word; voices `marin` (default), `cedar`, `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`; speed 0.25 to 1.5.
- `transcribe_audio({ path, language? })`: WAV, MP3, M4A, MP4, FLAC, Ogg, Opus or WebM up to 25 MB.
- `classify({ state, questions })`: `noul` (yes/no probability), `choice` (criteria maps options to descriptions) and `score` (2 to 10 ordered levels) questions; returns the answers as JSON.

Sources, masks and recordings must resolve inside the Session's working directory, and so must all output paths. Output filenames follow the returned format. Outside Chat mode, an explicit `path` can replace an existing file when no filesystem write guard is configured. With no explicit path, Tokamak reserves the output names without overwriting existing files, adding `-v2`, `-v3` on collisions. Extra images get `-2`, `-3` before the extension.

### Token effect

The five tool schemas add about 1,400 tokens to each request. An attached result image costs what the model charges for one image input; a transcript or classification costs its text.

### KV Cache effect

The schemas are constant, so they stay in the cached prefix.

## Known Limitations

- An image takes 20 to 60 seconds and costs about USD 0.2 at medium quality.
- Speech is read by a Realtime model one sentence at a time, at about USD 0.03 per minute; only WAV is returned.
- Organizations with a guardrail policy cannot use transcription, dictation or voice conversations until an admin allows unscreened voice; Read aloud and `text_to_speech` still work, since text is screened.
- A voice conversation ends after 15 minutes, as Tokamak closes it. Its transcript is added to the draft, not sent, so the user decides whether the agent sees it.
- Sources, masks and recordings larger than 25 MiB are refused.
- Files are written directly to the host path the Session filesystem resolves; a remote or virtual filesystem backend is not supported.
