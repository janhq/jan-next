# L03: Model picker, context ring, fallback chain, compaction

## Summary

Choosing a model, seeing how full the context is, what happens when a message cannot fit, when a model fails over, and compaction. Covers the context-overflow recovery, the image warning, the fallback notice and the Models-page policy cards.

Needs: the seed and the lane's mock server. Port block 9430. The mock model has a 16,000-token window. Add a second mock model `mock-small` with `contextWindow: 4000` to the `qa-mock` provider for the overflow cases.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L03-01 | any | Click the model name under the composer (right side). | A picker lists every available model grouped by provider, with the current one marked. Typing filters by contiguous substring | P1 |
| L03-02 | any | In the picker type `mck`. | No match is shown (search is a contiguous substring, not fuzzy). The empty state offers a way forward | P3 |
| L03-03 | any | With no models configured (fresh scratch home with the provider removed), open the picker. | It says there are no models and points to Settings > Models with a button that opens that page | P1 |
| L03-04 | stub | Pick `mock-model`, send, then switch to `mock-small` mid-chat, send again. | The switch is announced in the chat or the row, the next turn runs on the new model. If the history no longer fits the new window the app says so in plain words before sending | P0 |
| L03-05 | stub | Fill a chat past 80% of 4,000 tokens on `mock-small` (paste long text), look at the context ring. | The ring shows the fill as a percent and the number under it, and changes colour near full | P2 |
| L03-06 | stub | Click the ring. | A breakdown opens. The legend rows add up to the headline number (known open finding: they did not in an earlier walk) | P2 |
| L03-07 | stub | Paste text larger than `mock-small`'s whole window and press send. | Before sending, a notice says the message cannot fit and offers a choice (shorten, switch model). It is not sent to fail | P1 |
| L03-08 | stub | Server `context_overflow`. Send on a local-route model. | The failure card explains the context was exceeded in plain words, with an "Increase context size" action when the model's window can grow, or a "Compact" action when it cannot. No provider JSON | P0 |
| L03-09 | stub | Click "Increase context size" where offered. | The window grows to the next size, the same turn retries in the same chat, and the composer draft is untouched | P0 |
| L03-10 | stub | Click "Compact" on an overflow card. | A summary replaces older turns, a card says how many tokens were saved, the turn then retries | P1 |
| L03-11 | stub | Compact a chat that is already over its window. | Either the summary succeeds or the card says plainly it could not and why. It does not loop | P1 |
| L03-12 | any | `+` > Compact on a short chat. | A notice says there is nothing worth compacting, or it compacts. No empty summary | P3 |
| L03-13 | stub | Settings > Agent loop > Fallback models: add `qa-mock / mock-model` then `qa-mock / mock-small`. Server `rate_limit` forever for the first, success for the second (run two servers, or `--sequence rate_limit,success`). Send. | After the failure the chat shows which model took over. The picker shows the model that is actually answering | P1 |
| L03-14 | stub | After L03-13, let the cooldown pass and send again. | The app switches back to the home model only if the history fits there, and says so, or stays and says why. No silent state | P2 |
| L03-15 | any | Settings > Agent loop > Context: toggle auto-compaction, change the threshold, pick a summary model. | Each change takes effect for the next turn without a restart and survives relaunch | P1 |
| L03-16 | any | Set the threshold to the extremes (lowest, highest). | Values clamp or reject with a message. No NaN, no empty field accepted | P2 |
| L03-17 | stub | Attach an image and pick a text-only model. | A warning names the model and offers a model that can read images. Sending is still possible only after an explicit choice | P1 |
| L03-18 | stub | Server `quota_exceeded`. Send. | A plain message about quota with a next step; no loop of retries | P1 |
| L03-19 | stub | Remove the API key variable and relaunch, then send. Confirm first that no other provider key is exported in the shell (the README's `unset` loop), or the default model will answer with the leaked key and the case passes for the wrong reason. | A "missing credential" message with the exact next step (Settings > Models), not a stack trace and not a reply | P1 |
| L03-20 | stub | Open the picker while a turn is streaming. | Switching is blocked or deferred to the next turn with a visible reason. The running turn is not corrupted | P1 |
| L03-21 | any | Look at the row under the composer. | Only the model and the context ring show; a long model name ends with an ellipsis and does not run under the ring | P3 |
| L03-22 | stub | Open an old chat from before a model was removed. | The chat opens, shows which model it used, and lets you pick another. No crash | P1 |
