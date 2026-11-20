# @janhq/jan-image

Generate and edit images through the Tokamak Images API (`openai/gpt-image-2` by default) and save them in the Session's working directory.

## Use this plugin

The desktop bundle mounts it as the `jan-image` row. Ask Jan for a picture ("draw an orange cat astronaut") or a change to an image in the folder ("give the cat a red scarf"); the agent calls the tool, the file is saved, and the agent presents it so the chat shows it under the reply.

| Field | Default | Meaning |
|---|---|---|
| `apiBaseURL` | `TOKAMAK_BASE_URL`, else `https://api.tokamak.sh/v1` | Tokamak API root; a bare origin gets `/v1` |
| `model` | `openai/gpt-image-2` | Image model id on Tokamak |
| `timeoutMs` | `180000` | Longest wait for one image request |

Requests use the signed-in Tokamak account's key, then the `TOKAMAK_API_KEY` credential. Without either, the tool tells the user to sign in to Tokamak in Settings > Account. A key the server rejects with HTTP 401 signs the account out, as web search does.

## Model Experience

Two tools, registered for every Agent:

- `generate_image({ prompt, path?, size?, quality?, background?, n? })` - `POST /images/generations`.
- `edit_image({ prompt, images, mask?, path?, size?, quality?, background?, n? })` - `POST /images/edits`, every source as `image[]`; a PNG mask's transparent pixels mark the area to change.

`size` is `auto`, `1024x1024`, `1536x1024` or `1024x1536`; `quality` is `auto`, `low`, `medium` or `high`; `background` is `auto`, `transparent` or `opaque`; `n` is 1 to 4. Images are written inside the working directory only: an explicit `path` is overwritten (its extension follows the returned format), and without one the file is `images/<prompt words>.png`, or `<first source>-edited.png` for an edit, with a `-v2`, `-v3` suffix instead of overwriting. Extra images get `-2`, `-3` before the extension.

The result text lists the saved files and asks the agent to call `present`. When the calling model reads images, the images are attached too, so it can check its own result.

### Token effect

The two tool schemas add about 600 tokens to each request. An attached result image costs what the model charges for one image input.

### KV Cache effect

The schemas are constant, so they stay in the cached prefix.

## Known Limitations

- One image takes 20 to 60 seconds and costs about USD 0.2 at medium quality; the tool shows only "Running generate_image" with the clock until it finishes.
- Sources and masks larger than 25 MiB are refused.
- Images are written directly to the host path the Session filesystem resolves; a remote or virtual filesystem backend is not supported.
