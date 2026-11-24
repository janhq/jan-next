# L04: Local models

## Summary

Downloading, pausing, resuming and loading llama.cpp models, per-model context length and auto-fit, and what the chat shows while a local model loads or reads a long prompt.

Needs: the seed, the network, and 5 GB of free disk. Run alone: the timing cases are meaningless next to other lanes. Port block 9440. Use a small model: Qwen3 0.6B Q4 (about 0.5 GB). Check free disk first and record it.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L04-01 | any | Settings > Models > Local model. | Lists installed models with size, status and context settings, or an empty state with a way to add one | P1 |
| L04-02 | local | Add a model from a Hugging Face repository (`Qwen/Qwen3-0.6B-GGUF`), pick the Q4 file, press Download. | A progress row appears with bytes, percent, speed and time left (for example "48 MB/s · 2 min left"); the time left counts down and is hidden while paused or when the size is unknown. The Downloads page (More > Downloads) shows the same row | P1 |
| L04-03 | local | Pause the download at about 30%. Watch for 10 seconds. | Progress stops, the row says Paused, no bytes grow | P1 |
| L04-04 | local | Resume. | It continues from the partial file (not from zero) and finishes. The final size matches the repository's size | P0 |
| L04-05 | local | Pause, quit the app, relaunch, resume. | Same as L04-04: resumed from the partial file | P1 |
| L04-06 | local | Cut the network (Wi-Fi off) during a download. | The row shows a failure or waiting state in plain words with a Resume or Retry action. Re-enabling the network and pressing it finishes the file | P1 |
| L04-07 | local | Delete a half-downloaded model. | The row and the partial file go away; the disk space returns; no ghost row after relaunch | P1 |
| L04-08 | local | Download the same file twice. | The second attempt says it is already installed or is refused. No duplicate row | P2 |
| L04-09 | local | Set free disk lower than the file (or point at a full volume) and download. | A plain "not enough space" message before or during the download, not a silent stall | P1 |
| L04-10 | local | Pick the installed model and send "hello". | While it loads the chat says the model is loading, then (for a long prompt) shows prompt reading progress, then streams. No frozen window | P0 |
| L04-11 | local | Send a 4,000-word prompt to the local model. | The running detail shows prompt-processing progress that advances. Stop works during it | P1 |
| L04-12 | local | Open the model's settings: context length and Auto-fit. | Shows the configured context size and an Auto-fit toggle with a one-line hint. Copy is translated in the chosen UI language | P1 |
| L04-13 | local | Set context length to 2048, send a prompt of about 4,000 tokens. | The failure card offers "Increase context size". Two presses reach 4096 then 8192. The retry runs in the same chat with the draft untouched | P0 |
| L04-14 | local | Turn Auto-fit on, relaunch, send. | The setting is still on, and the model loads with a context that fits memory. The setting is per model, not global | P1 |
| L04-15 | local | Set context length above what the model supports. | Clamped or refused with a message. The model still loads | P1 |
| L04-16 | local | Load two local models one after the other. | The first unloads or the memory use is explained; the second answers; no crash | P1 |
| L04-17 | local | Quit while the model is loaded. | The llama.cpp worker process exits (check Activity Monitor). No orphan process holding memory | P1 |
| L04-18 | local | Kill the worker process from Activity Monitor during a turn. | The turn fails in plain words with Retry. Retry restarts the worker and answers | P1 |
| L04-19 | local | Import a model from a local path or URL, if the dialog offers it. | The dialog accepts a path, shows progress, and fails clearly on a wrong path | P2 |
| L04-20 | any | Switch the UI language to Chinese and reopen the model settings. | Every label, including context length and Auto-fit, is translated, none shows an English key | P2 |
