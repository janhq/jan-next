# Agent settings

Jan can read public settings and ask to change them from chat. It uses the Host settings service, not the Settings window or a config file. Each valid change asks once unless the chat uses full access. The approval card shows the old value, the proposed value, and whether the change applies to this chat only or is saved for all chats. Declining leaves settings unchanged.

## Model experience

- `jan_settings_read({ namespace? })`: Omit `namespace` to list public namespaces. Supply a namespace to get the public field paths, effective values, types, defaults, ranges, descriptions, and source where available. Secret fields and credential references are omitted.
- `jan_settings_change({ scope: "saved", namespace, path, value })`: Save a literal scalar value to the named Host plugin. To save up to four fields in the same namespace with one approval, pass `changes: [{ path, value }]` instead of the single `path` and `value`. The Host validates the revision seen for approval and applies the set operations together. The result reports the effective Settings value and where to find it, or the Host's reason for rejecting the change.
- `jan_settings_change({ scope: "chat", provider?, model?, reasoningEffort? })`: Select an existing model and/or reasoning effort for the current Session only. Pass `null` for `reasoningEffort` to restore the model's default effort. The tool records the same Session selection as the model picker without saving a new default for other chats. If the user changes the selection while the card is open, ask again.

For example, to set the compaction threshold to 85%, pass `namespace: "compaction-settings"`, `path: ["thresholdRatio"]`, `value: 0.85`, and `scope: "saved"`. See **Settings > Agent loop > Context > Compact at**. When the Host preference is unset, the stock threshold shown there is `0.8`. A saved preference is distinct from the compaction backend's later decision, which can also depend on a deployment's preset and model policy.

The model cannot read credentials or change permissions and approval policy, MCP servers, model provider definitions or credentials, plugin market indexes, or the agent-settings plugin's own configuration. These tools add no settings fields or browser slots of their own.
