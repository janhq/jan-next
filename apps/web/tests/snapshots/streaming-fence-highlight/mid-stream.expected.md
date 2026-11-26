- tablist "Chat tabs":
  - tab "Stream one TypeScript fence for Close chat tab" [selected]:
    - text: Stream one TypeScript fence for
    - button "Close chat tab"
  - button "New tab"
  - button "More actions"
  - button "Open right sidebar"
- tablist:
  - tab "Chat" [selected]
  - tab "Trajectory"
- button "More conversation views"
- text: Stream one TypeScript fence for the highlighting snapshot. {{clock}}
- button "Copy"
- button "Inject context runtime-context"
- button "Inject context time-context"
- text: ts
- button "Wrap lines" [pressed]
- button "Copy"
- code: "const first: number = 1 const second = \"two\" let tail"
- status: Writing
- text: Writing - {{duration}}
- textbox "Message or run a task, / commands, @ files or sessions"
- button "Add files or run commands"
- 'button "Access mode, current: Full access"': Full access
- button "Select model, current streaming-fence": streaming-fence
- button "Stop generating"
- button "Choose project" [disabled]: workspace
- 'button "Finish the current reply before switching: Standard mode" [disabled]': Standard mode

---

{
  "language": "ts",
  "pre": {
    "className": "shiki css-variables",
    "style": "background-color: var(--shiki-background); color: var(--shiki-foreground);",
    "tabIndex": "0"
  },
  "lines": [
    [
      {
        "text": "const",
        "style": "color: var(--shiki-token-keyword);"
      },
      {
        "text": " first",
        "style": "color: var(--shiki-token-constant);"
      },
      {
        "text": ":",
        "style": "color: var(--shiki-token-keyword);"
      },
      {
        "text": " number",
        "style": "color: var(--shiki-token-constant);"
      },
      {
        "text": " =",
        "style": "color: var(--shiki-token-keyword);"
      },
      {
        "text": " 1",
        "style": "color: var(--shiki-token-constant);"
      }
    ],
    [
      {
        "text": "const",
        "style": "color: var(--shiki-token-keyword);"
      },
      {
        "text": " second",
        "style": "color: var(--shiki-token-constant);"
      },
      {
        "text": " =",
        "style": "color: var(--shiki-token-keyword);"
      },
      {
        "text": " \"two\"",
        "style": "color: var(--shiki-token-string-expression);"
      }
    ],
    [
      {
        "text": "let",
        "style": "color: var(--shiki-token-keyword);"
      },
      {
        "text": " tail",
        "style": "color: var(--shiki-foreground);"
      }
    ]
  ]
}
