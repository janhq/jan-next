# @janhq/jan-status-bar

A bar along the bottom of the Jan window, like the one in VS Code. Out of the box it shows **Keep awake**, then **CPU**, **memory** and **GPU** load as percentages. Each reading turns amber, then red, as load rises; hover one for the details (memory shows used and total GB). Any plugin can add its own items.

## Use it

- **Right-click the bar** to tick items on or off, hide one item, move it to the other side, switch to icons only, or hide the bar.
- **Drag an item** along the bar to reorder it or move it to the other side.
- **Keep awake**: click it to choose **On** (always awake), **Agent** (awake only while an agent is working) or **Off**. The cup turns green while the blocker is active, and red if it failed.
- **Customize > Plugins > Status bar** has the same switches plus the reading interval, the amber and red thresholds, the side and order of each item, and **Reset layout**.
- **Toggle status bar** is a shortcut command with no default key; bind one in Settings > Shortcuts.

More built-in items wait hidden in the right-click menu: **Agent activity** (agents working and chats that need you; click to open one), **Connection** and **Clock**.

## Add your own item

Register a component into `statusbar.left` or `statusbar.right` from your plugin's browser half. The slot is where the item starts; the user can move it. `order` sorts items within a side (lower is further left). `label` names the item in the right-click menu and in Settings.

```js
// client.js of your plugin
apply(ctx) {
  ctx.slots.inject('statusbar.right', () => ctx.slots.register({
    name: 'statusbar.right',
    id: 'acme.build',          // unique, namespaced; also the key of the user's placement
    order: 50,
    label: () => 'Build',
  }, ({ StatusItem, compact }) => h(StatusItem, {
    icon: 'activity',          // a built-in glyph name, or any React node
    text: 'Build passing',
    tooltip: 'Last build passed 2 min ago',
    onClick: () => openBuilds(), // omit for a plain readout
    compact,
  })))
}
```

Every item receives, from the slot itself:

| Prop | What it is |
|---|---|
| `StatusItem` | The bar's item component: `icon`, `iconState` (`'on'` colours the icon green, `'error'` red), `text`, `tooltip`, `onClick`, `ariaLabel`, `level` (`'ok'`, `'warn'`, `'critical'`), `percent` (draws a small meter), `children` |
| `compact` | `true` when the user chose icons only; pass it on to `StatusItem` |
| `side` | `'left'` or `'right'`, where the item currently sits |
| `useSystemLoad(selector)` | `{ status: 'waiting' \| 'ready' \| 'failed', value: { cpu, memory: { percent, used, total }, gpu: { percent, source }, process } }`; reading starts while any item subscribes |
| `useKeepAwake(selector)` | `{ mode, active, working, error }` from the Host |
| `useStatusBarSettings(selector)` | The bar's own settings snapshot (`value.warnAt`, `value.criticalAt`, ...) |

Built-in glyph names: `cpu`, `memory`, `gpu`, `coffee`, `activity`, `link`, `clock`. Root-scoped standard hooks such as `useSessionStatus` and `useSessions` are available as in any root slot.

## How it works

- **Host** (`index.mjs`): serves `/jan-api/status-bar` with `resources` and `awake`. `resources.mjs` reads CPU from `os.cpus()`, memory from `vm_stat` (macOS, counted like Activity Monitor), `/proc/meminfo` (Linux) or `os.freemem()` (Windows), and GPU from `ioreg` (Apple GPUs), `nvidia-smi`, `/sys/class/drm/*/device/gpu_busy_percent` (AMD on Linux) or the Windows `GPU Engine` counters. A GPU source that fails once is not retried, and readings are shared across windows for one second. `awake.mjs` holds `caffeinate -i` (macOS), `systemd-inhibit` (Linux) or `SetThreadExecutionState` (Windows), each tied to the Host's process id, so a crashed Host never leaves the computer awake.
- **Browser** (`client.js`): occupies `shell.bottom`, declares the two item slots, and polls the Host only while a load item is shown and the window is visible. Copy (`client.locale.js`) and placement rules (`client.layout.js`) load with the bar; the settings page (`client.settings.js`) loads when Settings opens it.
- **Settings**: every preference is a live Config field (`visible`, `compact`, `interval`, `warnAt`, `criticalAt`, `awake`, `items`), so changes apply without a restart.

## Known limits

- GPU use is missing on Intel or AMD GPUs on macOS that do not report `Device Utilization %`, and on Linux GPUs without `nvidia-smi` or the amdgpu busy file. The item then says so in its tooltip.
- The bar takes the single `shell.bottom` seat, so another plugin that occupies it cannot be mounted alongside.
