const COMMANDS: &[&str] = &[
    "workspace_path",
    "thread_workspace_path",
    "thread_workspace_delete",
    "thread_workspace_sweep",
    "skill_list",
    "skill_read",
    "skill_write",
    "skill_delete",
    "skill_invoke",
    "memory_list",
    "memory_read",
    "memory_write",
    "memory_catalog",
    "memory_delete",
    "tool_schemas",
    "sandbox_status",
    "execute_tool",
    "execute_tool_streaming",
    "cancel_thread_bash",
];

fn main() {
    #[cfg(feature = "tauri")]
    tauri_plugin::Builder::new(COMMANDS).build();

    #[cfg(not(feature = "tauri"))]
    let _ = COMMANDS;
}
