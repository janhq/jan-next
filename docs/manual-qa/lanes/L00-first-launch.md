# L00: First launch, onboarding, seed profile

## Summary

Runs once, alone, before any other lane. It starts the app on an empty home, walks onboarding, registers the mock model provider and saves the result as the seed every other lane clones. It also checks what a brand-new user meets.

Needs: nothing. Home is `/tmp/jan-qa/L00/home`, empty. Port block 9400.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L00-01 | any | Create an empty `/tmp/jan-qa/L00/home` and user-data directory. Run `corepack pnpm run dev:desktop` with `JAN_HOME`, `JAN_DESKTOP_USER_DATA_DIR`, and the three debugging ports of block 9400 set. Do not touch anything for 90 seconds after the build finishes. | One window opens within 60 seconds of the build ending. No crash, no blank white window, no raw stack trace or JSON in the window | P0 |
| L00-02 | any | Look at the first screen without clicking. | The screen says what Jan is and what to do next in one sentence. The primary action is the most prominent control. No placeholder text, no untranslated key like `settings.account.step` | P1 |
| L00-03 | any | Resize the window from 1440 x 900 down to 900 x 600, then up to full screen. | Nothing overlaps, no control moves off screen, no horizontal scrollbar | P2 |
| L00-04 | any | Walk onboarding using only the visible buttons. Write down the name of every step in the result file. Choose "use an API key" if offered. | Each step has one clear way forward and a way back. Finishing lands on the chat home ("How can I help you today?"), not on a blank page | P0 |
| L00-05 | any | Quit the app. Edit `$JAN_HOME/profiles/desktop/cordis.patch.yml` and append the `qa-mock` provider block shown below. Relaunch. Open the model picker under the composer. | The picker lists `qa-mock / mock-model`. Selecting it shows the name under the composer on the right | P1 |
| L00-06 | stub | Start the mock server (`--sequence success --repeat-last`) on port 9403. Send "hello". | A streamed reply appears within 5 seconds, the send button turns into a stop button while streaming and back after, and the chat appears in the sidebar list with a title | P0 |
| L00-07 | any | Quit with Cmd+Q. Relaunch with the same home. | The window returns on the chat home, onboarding does not run again, and the chat from L00-06 is in the sidebar | P0 |
| L00-08 | any | With the original Jan data folder absent, look for any import prompt on first launch. | No import prompt appears when there is nothing to import. (L10 covers the prompt when there is) | P2 |
| L00-09 | any | Open the app with no network (turn Wi-Fi off) on a fresh home. | The window still opens and says plainly that there is no connection if something needs one. No endless spinner | P1 |
| L00-10 | any | Make the seed: quit the app, then `mkdir -p /tmp/jan-qa/seed && cp -cR /tmp/jan-qa/L00/home /tmp/jan-qa/seed/home && cp -cR /tmp/jan-qa/L00/ud /tmp/jan-qa/seed/ud`. Launch lane L01's recipe on the seed. | The app opens on the chat home with `qa-mock` available, the L00-06 chat in the sidebar, and no onboarding | P0 |

`qa-mock` provider block for L00-05 (appended to the profile's patch file):

```yaml
- id: llm-pi-ai
  name: "@janhq/jan-llm-pi-ai"
  config:
    providers:
      qa-mock:
        displayName: QA mock
        api: anthropic-messages
        baseURLEnv: QA_MOCK_BASE_URL
        apiKeyEnv: MOCK_MESSAGES_API_KEY
        models:
          - id: mock-model
            contextWindow: 16000
            input:
              - text
```

If the profile already has an `llm-pi-ai` entry, add `qa-mock` under its `providers` instead of a second entry. Keep the Anthropic-compatible `api` value: the mock server speaks the Messages protocol.
