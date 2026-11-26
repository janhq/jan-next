- button "子智能体已完成任务 {{clock}}" [expanded]:
  - text: 子智能体已完成任务
  - time: {{clock}}
- paragraph: 这条通知触发了本轮回复。
- text: "Background subagent agent-1 finished and will do no further work unless you send it more.Status: completed Summary: See closing message below. Evidence: Not reported. Blockers: Not reported. Changed files: Not reported.Its closing message:## Research result The original child reply stays available."

- button "子智能体任务已停止 {{clock}}" [expanded]:
  - text: 子智能体任务已停止
  - time: {{clock}}
- paragraph: 这条通知触发了本轮回复。
- text: "Background subagent agent-1 was stopped before it finished.Status: interrupted Summary: See closing message below. Evidence: Not reported. Blockers: Not reported. Changed files: Not reported.Its closing message:## Research result The original child reply stays available."

- button "子智能体执行失败 {{clock}}" [expanded]:
  - text: 子智能体执行失败
  - time: {{clock}}
- paragraph: 这条通知触发了本轮回复。
- text: "Background subagent agent-1 failed before it finished.Status: failed Summary: See closing message below. Evidence: Not reported. Blockers: Not reported. Changed files: Not reported.Its closing message:## Research result The original child reply stays available."

- button "子智能体已达 token 上限 {{clock}}" [expanded]:
  - text: 子智能体已达 token 上限
  - time: {{clock}}
- paragraph: 这条通知触发了本轮回复。
- text: "Background subagent agent-1 ran out of room before it finished.Status: failed Summary: See closing message below. Evidence: Not reported. Blockers: Not reported. Changed files: Not reported.Its closing message:## Research result The original child reply stays available."

- button "子智能体拒绝执行 {{clock}}" [expanded]:
  - text: 子智能体拒绝执行
  - time: {{clock}}
- paragraph: 这条通知触发了本轮回复。
- text: "Background subagent agent-1 declined the task.Status: failed Summary: See closing message below. Evidence: Not reported. Blockers: Not reported. Changed files: Not reported.Its closing message:## Research result The original child reply stays available."

- button "子智能体已完成任务 {{clock}}" [expanded]:
  - text: 子智能体已完成任务
  - time: {{clock}}
- paragraph: 这条通知触发了本轮回复。
- text: "Background subagent agent-1 finished and will do no further work unless you send it more.Status: completed Summary: No closing message. Evidence: Not reported. Blockers: Not reported. Changed files: Not reported.It left no closing message."

- button "子任务状态更新 {{clock}}" [expanded]:
  - text: 子任务状态更新
  - time: {{clock}}
- paragraph: 这条通知触发了本轮回复。
- text: Background subagent finished.
