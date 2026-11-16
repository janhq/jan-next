// Browser half of the open-waifu shell plugin. Hand-written for DSH's module
// loader (no build step): `require` hands out the shell's shared React and
// slot runtime, and `apply` registers everything through `ctx.slots`.
window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-shell',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      IconPluginPinwheelOutlineRegular, IconSettingsOutlineMedium, IconDatabaseOutlineRegular, IconCheckOutlineRegular,
      IconNewChatOutlineMedium, IconNewChatOutlineRegular, IconProjectAddOutlineRegular, IconSearchOutlineRegular,
      MenuItemButton, ShortcutKeys,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    // Optional: the matching host publishes the header model seat. An older
    // host leaves the composer's own selector in place instead.
    let HeaderModelSelection
    try {
      HeaderModelSelection = require('@deepseek-ai/dsh-client-ui-model-selection/client').HeaderModelSelection
    } catch (error) {
      console.warn('open-waifu-shell: header model selection unavailable', error)
      HeaderModelSelection = undefined
    }
    const shell = window.__OW_SHELL__ ?? { look: null }
    // Present only inside the app window; a plain browser tab has no window to drive.
    const tauri = window.__TAURI_INTERNALS__
    const win = (cmd) => tauri.invoke(`plugin:window|${cmd}`, { label: 'main' })

    // Jan's blue accent, the app's default when the settings carry none.
    const look = shell.look ?? { primary: '#456BDE', sidebar: { light: '#C4D0F3', dark: '#0F2157' } }
    const both = (v) => ({ light: v, dark: v })
    // Jan's palette (web-app/src/index.css) mapped onto DSH's alias tokens.
    const TOKENS = {
      '--dsh-font-family-text': both("'Inter', 'Segoe UI', sans-serif"),
      '--dsw-alias-bg-base': { light: 'oklch(1 0 0)', dark: 'oklch(0.18 0 0)' },
      '--dsw-alias-bg-layer-1': { light: 'oklch(1 0 0)', dark: 'oklch(0.205 0 0)' },
      '--dsw-alias-bg-layer-2': { light: 'oklch(0.97 0 0)', dark: 'oklch(0.235 0 0)' },
      '--dsw-alias-bg-overlay': { light: 'oklch(1 0 0)', dark: 'oklch(0.205 0 0)' },
      '--dsw-alias-border-l1': { light: 'oklch(0.922 0 0)', dark: 'oklch(1 0 0 / 10%)' },
      '--dsw-alias-border-l2': { light: 'oklch(0.88 0 0)', dark: 'oklch(1 0 0 / 15%)' },
      '--dsw-alias-label-primary': { light: 'oklch(0.145 0 0)', dark: 'oklch(0.985 0 0)' },
      '--dsw-alias-label-secondary': { light: 'oklch(0.556 0 0)', dark: 'oklch(0.708 0 0)' },
      '--dsw-alias-button-primary-fill': both(look.primary),
      '--dsw-alias-button-info-fill': both(look.primary),
      '--dsw-alias-state-business-primary': both(look.primary),
      '--dsw-specific-input-major': { light: 'oklch(0.97 0 0)', dark: 'oklch(0.235 0 0)' },
      '--dsw-specific-selector': { light: 'oklch(0.94 0 0)', dark: 'oklch(0.269 0 0)' },
      '--dsw-specific-bubble': {
        light: `color-mix(in oklch, ${look.primary} 22%, white)`,
        dark: `color-mix(in oklch, ${look.primary} 70%, black)`,
      },
      '--dsw-specific-sidebar-fill': look.sidebar,
      '--dsw-specific-sidebar-nav-item-hover': {
        light: `color-mix(in oklch, ${look.sidebar.light} 85%, black)`,
        dark: `color-mix(in oklch, ${look.sidebar.dark} 85%, white)`,
      },
      '--dsw-specific-sidebar-nav-item-active': {
        light: `color-mix(in oklch, ${look.sidebar.light} 75%, black)`,
        dark: `color-mix(in oklch, ${look.sidebar.dark} 75%, white)`,
      },
      '--dsw-specific-sidebar-nav-item-active-accent': {
        light: `color-mix(in oklch, ${look.sidebar.light} 75%, black)`,
        dark: `color-mix(in oklch, ${look.sidebar.dark} 75%, white)`,
      },
    }

    const CSS = `
@font-face { font-family: 'Inter'; font-display: swap; font-weight: 100 900; src: url('/ow-shell/assets/InterVariable.woff2') format('woff2'); }
@font-face { font-family: 'StudioFeixenSans'; font-display: swap; font-weight: 500; src: url('/ow-shell/assets/StudioFeixenSans-Medium.otf') format('opentype'); }
.ow-name { font-family: 'StudioFeixenSans', 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.ow-titlebar { position: fixed; inset: 0 0 auto 0; height: var(--dsh-windows-titlebar-height); z-index: 40; pointer-events: none; }
.ow-titlebar > .ow-drag { position: absolute; inset: 0 140px 0 280px; pointer-events: auto; }
.ow-controls { position: absolute; top: 0; right: 0; display: flex; height: 100%; pointer-events: auto; }
.ow-controls button { width: 46px; height: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; cursor: default; }
.ow-controls button:hover { background: color-mix(in oklch, var(--dsw-alias-label-primary) 10%, transparent); color: var(--dsw-alias-label-primary); }
.ow-controls button.ow-close:hover { background: #c42b1c; color: #fff; }
/* DSH 0.2.2's public data-slot anchors and frame data attributes delimit these
   rules. Only the shipped shell's immediate structure is styled; no hashed
   classes, DOM moves, or blanket slot suppression. A replaced parent owns its
   own geometry. Later theme plugins can override tokens, and later CSS can
   override these marker-scoped rules. */
  html[data-ow-shell] {
    --ow-sidebar-gap: 12px;
    --ow-sidebar-radius: 14px;
  }
  html[data-ow-shell] [data-slot='root'] > [data-sidebar-collapsed], html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay]) {
    background: var(--dsw-alias-bg-base);
  }
  html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay])::before { background: var(--dsw-alias-bg-base); }
  html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay]) > :has([data-slot='main']) {
    border: 0;
    border-radius: 0;
  }
  html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay]):not([data-sidebar-collapsed]):not([data-sidebar-drawer]) > :has(> [data-slot='sidebar']) {
    position: relative;
    margin: var(--ow-sidebar-gap) 0 var(--ow-sidebar-gap) var(--ow-sidebar-gap);
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: var(--ow-sidebar-radius);
    background: var(--dsw-alias-bg-base);
    overflow: hidden;
  }
  html[data-ow-shell] [data-slot='sidebar'] > div:has(> [data-window-drag]) {
    width: 100% !important; /* DSH passes the outer column width, before the inset. */
    background: linear-gradient(to bottom, var(--dsw-specific-sidebar-fill), var(--dsw-alias-bg-base));
    padding: 6px 8px;
  }
  html[data-ow-shell] body[data-ds-dark-theme] [data-slot='sidebar'] > div:has(> [data-window-drag]) {
    background: linear-gradient(to bottom, color-mix(in srgb, var(--dsw-specific-sidebar-fill) 70%, transparent), var(--dsw-alias-bg-base));
  }
  html[data-ow-shell] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) {
    height: 40px;
    padding: 0 2px 0 4px;
    margin: 0 0 8px;
  }
  html[data-ow-shell] [data-slot='sidebar'] [data-slot='sidebar.brand.mark']:has(.ow-sidebar-mark) { display: none; }
  html[data-ow-shell] [data-slot='sidebar.brand.name'] .ow-name { font-size: 14px; }
  html[data-ow-shell] [data-slot='sidebar'] [data-sidebar-toggle] {
    position: relative;
    inset: auto;
    margin-left: auto;
  }
  html[data-ow-shell]:has([data-sidebar-collapsed]) [data-slot='sidebar'] [data-sidebar-toggle] {
    position: fixed;
    top: calc((var(--dsh-windows-titlebar-height, 40px) - 28px) / 2);
    left: 12px;
  }
  html[data-ow-shell] [data-slot='sidebar'] > div > button {
    justify-content: flex-start;
    height: 36px;
    margin: 0 3px 2px;
    padding: 7px 9px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    box-shadow: none;
    font-weight: 400;
  }
  html[data-ow-shell] [data-slot='sidebar'] > div > button > span:first-child > span { width: auto; justify-content: flex-start; gap: 8px; }
  html[data-ow-shell] [data-slot='sidebar'] > div > button > span:last-child:not(:first-child) { opacity: 1; color: var(--dsw-alias-label-secondary); font-size: 11px; }
  html[data-ow-shell] [data-slot='sidebar'] nav { margin: 0 0 12px; }
  html[data-ow-shell] [data-slot='sidebar'] nav > button, html[data-ow-shell] [data-slot='sidebar'] nav > div > button { min-height: 36px; border-radius: 6px; }
  /* Jan has no panel launchers above the chat list. Plugins and Model Hub move
     to the footer; every remaining management page stays reachable through the
     native More menu, whose trigger keeps aria-haspopup. Without that trigger
     the rows stay so no page loses its only destination. */
  html[data-ow-shell] [data-slot='sidebar'] nav[aria-label]:has(button[aria-haspopup]) > button[aria-label]:not([aria-haspopup]) { display: none; }
  html[data-ow-shell] [data-row-key^='session:'] { min-height: 36px; }
  /* Jan's sidebar paints a gradient, while the native list fade fades to a
     single sidebar-fill colour: either choice paints a hard-edged band across
     the last row (blue with the accent, grey with the base). Drop the overlay;
     the list keeps its own clip. */
  html[data-ow-shell] [data-slot='sidebar.workspaces'] > div > div > div:has([role='tree']) > span:last-child { display: none; }
  html[data-ow-shell] [data-slot='sidebar.settings'] { color: var(--dsw-alias-label-secondary); }
  html[data-ow-shell] [data-slot='sidebar'] div:has(> [data-slot='sidebar.footer.action']) { flex-direction: column; align-items: stretch; }
  /* Jan's plain navigation rows. The leaves supply the real callbacks; the
     shell owns only how New Chat / New project / Search read. */
  .ow-nav-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; margin: 0 0 2px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; font-weight: 400; line-height: 20px; text-align: left; cursor: pointer; }
  .ow-nav-row > svg { flex: none; color: var(--dsw-alias-label-secondary); }
  .ow-nav-row:hover { background: var(--dsw-specific-sidebar-nav-item-hover); }
  .ow-nav-row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
  .ow-nav-row[data-rail] { justify-content: center; padding: 0; }
  .ow-nav-row[data-rail] > svg { color: inherit; }
  .ow-nav-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ow-nav-row > .ow-nav-shortcut { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
  /* Jan's "Chats" heading. The browser-owned search and view-options nodes stay
     mounted inside it; only their presentation folds while search is open. */
  .ow-list-header { flex: none; display: flex; align-items: center; gap: 4px; height: 36px; margin: 2px -4px 4px 0; padding-left: var(--dsh-sidebar-row-padding, 12px); color: var(--dsw-alias-label-tertiary); }
  .ow-list-heading { flex: none; font-size: 13px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-secondary); }
  .ow-list-tools { display: flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto; }
  .ow-list-actions { display: flex; align-items: center; }
  .ow-list-header[data-search-expanded] .ow-list-heading, .ow-list-header[data-search-expanded] .ow-list-actions { display: none; }
  .ow-list-header[data-search-expanded] .ow-list-tools { flex: 1; }
  /* Jan's provider/model pill sits at the main area's top left, before the
     Session title. The composer keeps no second selector. */
  html[data-ow-shell] [data-conversation-header-leading] [data-slot='conversation.header.model'] button { height: 36px; padding: 0 14px; gap: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; }
  html[data-ow-shell] [data-conversation-header-leading] [data-slot='conversation.header.model'] button > svg:first-child { display: none; }
  html[data-ow-shell] [data-conversation-header-leading] [data-slot='conversation.header.model'] button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
  html[data-ow-shell] [data-chat-running-mark] { background: url('/ow-shell/assets/jan-original.png') center / contain no-repeat; }
  html[data-ow-shell] [data-chat-running-mark] > * { display: none; }
  .ow-hero-title { width: 100%; margin: 0 0 16px; font-family: 'StudioFeixenSans', 'Inter', sans-serif; font-size: 24px; font-weight: 500; line-height: 32px; color: var(--dsw-alias-label-primary); text-align: center; text-wrap: balance; }
.ow-footer-action { width: 100%; min-height: 36px; display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; text-align: left; cursor: pointer; }
.ow-footer-action:hover { background: var(--dsw-specific-sidebar-nav-item-hover); color: var(--dsw-alias-label-primary); }
.ow-footer-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.ow-footer-action[data-rail] { justify-content: center; padding-inline: 0; }
.ow-plugin-footer { display: flex; flex-direction: column; width: 100%; min-width: 0; }
.ow-inventory-status { margin: 0; padding: 4px 9px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; text-wrap: pretty; }
.ow-menu-entry { display: flex; align-items: center; gap: 8px; width: 100%; }
.ow-menu-check { flex: none; margin-left: auto; color: var(--dsw-alias-state-business-primary); }
/* Native titlebar rules need to outrank DSH's platform rules; they never touch
   third-party panel or composer contents. The existing DSH track motion stays. */
html[data-ow-shell][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) { padding-top: 0; }
html[data-ow-shell][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) > :has([data-slot='main']),
html[data-ow-shell][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) > [data-rightbar-col] { padding-top: var(--dsh-windows-titlebar-height); }

`

    const svg = (d, size = 10) => h('svg', { width: size, height: size, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1 }, d)
    const Name = () => h('span', { className: 'ow-name' }, 'Jan')

    function TitleBar() {
      const [maximized, setMaximized] = React.useState(false)
      const sync = () => { win('is_maximized').then(setMaximized, () => { }) }
      React.useEffect(() => {
        sync()
        window.addEventListener('resize', sync)
        return () => window.removeEventListener('resize', sync)
      }, [])
      return h('div', { className: 'ow-titlebar' },
        h('div', { className: 'ow-drag', 'data-tauri-drag-region': '' }),
        h('div', { className: 'ow-controls' },
          h('button', { type: 'button', 'aria-label': 'Minimize', onClick: () => win('minimize') }, svg(h('path', { d: 'M0 5h10' }))),
          h('button', { type: 'button', 'aria-label': maximized ? 'Restore' : 'Maximize', onClick: () => win('toggle_maximize').then(sync) },
            svg(maximized ? h('path', { d: 'M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z' }) : h('rect', { x: 0.5, y: 0.5, width: 9, height: 9 }))),
          h('button', { type: 'button', className: 'ow-close', 'aria-label': 'Close', onClick: () => win('close') }, svg(h('path', { d: 'M0 0l10 10M10 0L0 10' })))))
    }

    const SidebarMark = () => h('span', { className: 'ow-sidebar-mark', 'aria-hidden': true })

    // One row shape for the sidebar controls Jan keeps plain. The rail keeps
    // the glyph and its accessible name; wide rows add the label and hint.
    function NavRow({ icon, label, shortcutKeys, shortcutAria, rail, buttonRef, onClick }) {
      return h('button', {
        type: 'button', className: 'ow-nav-row', 'data-rail': rail || undefined,
        'aria-label': label, title: rail ? label : undefined,
        'aria-keyshortcuts': shortcutAria, ref: buttonRef, onClick,
      }, icon,
        !rail && h('span', { className: 'ow-nav-label' }, label),
        !rail && shortcutKeys !== undefined && shortcutKeys.length > 0
        && h(ShortcutKeys, { keys: shortcutKeys, className: 'ow-nav-shortcut' }))
    }

    const NewSession = ({ wide, onStart, shortcutKeys, shortcutAria, t }) => h(NavRow, {
      icon: h(wide ? IconNewChatOutlineMedium : IconNewChatOutlineRegular, { size: wide ? 16 : 18 }),
      label: t('newChat'), shortcutKeys, shortcutAria, rail: !wide, onClick: onStart,
    })

    // The browser keeps the add flow and its anchor; forwarding the ref onto
    // the visible row is what lets the picker hang off the Jan control.
    function WorkspaceActions({
      wide, canAddWorkspace, onSearch, onAddWorkspace, addWorkspaceButtonRef,
      searchShortcut, addWorkspaceShortcut, t,
    }) {
      // The opening click must not reach the browser's outside-click dismissor.
      const requestSearch = (event) => {
        event.stopPropagation()
        onSearch()
      }
      return h(React.Fragment, null,
        canAddWorkspace && h(NavRow, {
          icon: h(IconProjectAddOutlineRegular, { size: wide ? 16 : 18 }),
          label: t('newProject'), shortcutKeys: addWorkspaceShortcut?.keys, shortcutAria: addWorkspaceShortcut?.aria,
          rail: !wide, buttonRef: addWorkspaceButtonRef, onClick: onAddWorkspace,
        }),
        h(NavRow, {
          icon: h(IconSearchOutlineRegular, { size: wide ? 16 : 18 }),
          label: t('search'), shortcutKeys: searchShortcut?.keys, shortcutAria: searchShortcut?.aria,
          rail: !wide, onClick: requestSearch,
        }))
    }

    // The search node owns its input and refs, so it stays mounted while wide;
    // the view-options node keeps its menu state the same way.
    const WorkspaceHeader = ({ wide, searchExpanded, search, viewOptions, t }) => wide
      ? h('div', { className: 'ow-list-header', 'data-search-expanded': searchExpanded || undefined },
        h('span', { className: 'ow-list-heading' }, t('chats')),
        h('div', { className: 'ow-list-tools' }, search, h('div', { className: 'ow-list-actions' }, viewOptions)))
      : null

    const HeroHeadline = ({ t }) => h('h1', { className: 'ow-hero-title' }, t('hero.headline'))

    // Jan has no panel launcher rows, so the native More menu becomes the one
    // list of management pages. Plugins and Model Hub keep their footer seats;
    // every other registered panel is opened from here, so hiding its launcher
    // never removes its only destination.
    function PanelDestinations({ entries, onOpen, onDismiss }) {
      // Model Hub already owns the Local models panel from the footer; every
      // other panel is listed here so Jan's launcher-less sidebar keeps each
      // destination.
      const rows = entries.filter(entry => entry.id !== 'ow-models')
      return h(React.Fragment, null, rows.map(entry => h(MenuItemButton, {
        key: entry.id, current: entry.active === true,
        onSelect: () => { onDismiss(); onOpen(entry.id) },
      }, h('span', { className: 'ow-menu-entry' }, entry.label,
        entry.active === true && h(IconCheckOutlineRegular, {
          size: 16, className: 'ow-menu-check', 'aria-hidden': true,
        })))))
    }

    function PluginManagerAction({ wide, useAvailable, useInventoryStatus, usePanelInfo, openPlugins, t }) {
      const available = useAvailable((value) => value)
      const inventoryStatus = useInventoryStatus((value) => value)
      const active = usePanelInfo((value) => value.activePanelId === 'plugins')
      if (!available) return null
      const reading = active && (inventoryStatus === 'idle' || inventoryStatus === 'loading')
      return h('div', { className: 'ow-plugin-footer' },
        h('button', {
          type: 'button', className: 'ow-footer-action', 'data-rail': !wide || undefined,
          'aria-label': t('plugins'), title: !wide ? t('plugins') : undefined,
          onClick: openPlugins,
        }, h(IconPluginPinwheelOutlineRegular, { size: 16 }), wide && t('plugins')),
        reading && h('p', { className: 'ow-inventory-status', role: 'status', 'aria-live': 'polite' }, t('plugins.reading')))
    }

    function ModelHubAction({ wide, useAvailable, openModelHub, t }) {
      const available = useAvailable((value) => value)
      if (!available) return null
      return h('button', {
        type: 'button', className: 'ow-footer-action', 'data-rail': !wide || undefined,
        'aria-label': t('modelHub'), title: !wide ? t('modelHub') : undefined,
        onClick: () => { if (available) openModelHub() },
      }, h(IconDatabaseOutlineRegular, { size: 16 }), wide && t('modelHub'))
    }

    function SettingsLauncher({ wide, settingsOpen, settingsShortcut, openSettings, t }) {
      return h('button', {
        type: 'button', className: 'ow-footer-action', 'data-rail': !wide || undefined,
        'aria-label': t('settings'), title: !wide ? t('settings') : undefined,
        'aria-haspopup': 'dialog', 'aria-expanded': settingsOpen,
        'aria-keyshortcuts': settingsShortcut?.aria, onClick: openSettings,
      }, h(IconSettingsOutlineMedium, { size: 16 }), wide && t('settings'))
    }

    return {
      name: 'ow-shell',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@open-waifu/dsh-shell'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'open-waifu-shell: styles')

        ctx.inject(['theme'], (scope) => {
          scope.effect(() => scope.theme.overrideTokens('open-waifu', TOKENS), 'open-waifu-shell: Jan palette')
        })

        const html = document.documentElement
        html.setAttribute('data-ow-shell', '')
        ctx.effect(() => () => html.removeAttribute('data-ow-shell'), 'open-waifu-shell: root marker')

        ctx.inject(['uiWorkspace'], (scope) => {
          // Jan's list is a flat Chats list; the public setter persists through
          // the existing workspace view store, so call it once per mount.
          scope.uiWorkspace.setSessionGrouping('flat')
        })

        ctx.inject(['locale'], (scope) => {
          scope.effect(() => scope.locale.register('open-waifu.shell', {
            en: {
              'hero.headline': 'How can I help you today?',
              chats: 'Chats',
              newChat: 'New Chat',
              newProject: 'New project',
              search: 'Search',
              modelHub: 'Model Hub',
              plugins: 'Plugin manager', 'plugins.reading': 'Reading plugins...', settings: 'Settings',
            },
            zh: {
              'hero.headline': '今天有什么可以帮您？',
              chats: '聊天',
              newChat: '新对话',
              newProject: '新项目',
              search: '搜索',
              modelHub: '中心',
              plugins: '插件管理', 'plugins.reading': '正在读取插件...', settings: '设置',
            },
          }), 'open-waifu-shell: owned copy')
        })

        // Single seats elect the lowest priority. These replace bundled chrome
        // at zero; a user plugin can shadow Jan with priority -2 or lower.
        ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, SidebarMark))
        ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, Name))
        // Jan's navigation rows and chat heading. Each leaf keeps the browser's
        // own callback, ref, search node and view options.
        ctx.slots.inject('sidebar.session.new', () => ctx.slots.register({ name: 'sidebar.session.new', priority: -1, locale: 'open-waifu.shell' }, NewSession))
        ctx.slots.inject('sidebar.workspaces.actions', () => ctx.slots.register({ name: 'sidebar.workspaces.actions', priority: -1, locale: 'open-waifu.shell' }, WorkspaceActions))
        ctx.slots.inject('sidebar.workspaces.header', () => ctx.slots.register({ name: 'sidebar.workspaces.header', priority: -1, locale: 'open-waifu.shell' }, WorkspaceHeader))
        // Jan's greeting replaces the bundled headline stack; the rest of the
        // hero and composer stay DSH's own.
        ctx.slots.inject('conversation.hero.headline', () => ctx.slots.register({ name: 'conversation.hero.headline', priority: -1, locale: 'open-waifu.shell' }, HeroHeadline))
        // The More menu's real panel destinations. Registering it also keeps
        // the More trigger present, so no launcher row is hidden without a
        // reachable menu entry.
        ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
          name: 'sidebar.panellist.actions', id: 'ow-panel-destinations', order: -100,
        }, PanelDestinations))

        if (HeaderModelSelection !== undefined) {
          // The header pill and the composer row read one native directory; the
          // shell moves the seat and declares no child slots of its own.
          ctx.plugin(HeaderModelSelection)
          ctx.slots.inject('conversation.input.model', () => ctx.slots.register({ name: 'conversation.input.model', priority: -1 }, () => null))
        }

        ctx.inject(['layout'], (scope) => {
          scope.layout.configureSidebar({ defaultWidth: 240, minWidth: 224, maxWidth: 320 })
          const available = {
            getSnapshot: () => scope.slots.entriesOfSlot('main').some((entry) => entry.options.key === 'plugins'),
            subscribe: (listener) => scope.slots.subscribe('main', listener),
          }
          // Observe only the elected Plugins page's injected inventory. Registrant
          // names are diagnostic labels, not stable package identifiers. A custom
          // page without this observable owns its own loading presentation.
          const sources = new WeakMap()
          const inventorySource = () => {
            const entry = scope.slots.entriesOfSlot('main').find((candidate) => candidate.options.key === 'plugins')
            if (!entry) return undefined
            if (!sources.has(entry)) {
              const source = entry.inject?.().hooks?.pluginManager
              sources.set(entry, typeof source?.getSnapshot === 'function' && typeof source?.subscribe === 'function' ? source : undefined)
            }
            return sources.get(entry)
          }
          const inventoryStatus = {
            getSnapshot: () => inventorySource()?.getSnapshot().status,
            subscribe: (listener) => {
              let offSource = () => { }
              const bind = () => {
                offSource()
                offSource = inventorySource()?.subscribe(listener) ?? (() => { })
                listener()
              }
              const offLedger = scope.slots.subscribe('main', bind)
              bind()
              return () => { offLedger(); offSource() }
            },
          }
          const modelHubAvailable = {
            getSnapshot: () => scope.slots.entriesOfSlot('sidebar.panellist').some((entry) => entry.options.id === 'ow-models'),
            subscribe: (listener) => scope.slots.subscribe('sidebar.panellist', listener),
          }
          scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
            name: 'sidebar.footer.action', id: 'ow-model-hub', order: -10,
            locale: 'open-waifu.shell',
            inject: () => ({
              hooks: { available: modelHubAvailable },
              openModelHub: () => scope.layout.selectPanel('ow-models'),
            }),
          }, ModelHubAction))
          scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
            name: 'sidebar.footer.action', id: 'ow-plugin-manager', order: 0,
            locale: 'open-waifu.shell',
            inject: () => ({
              hooks: { available, inventoryStatus },
              openPlugins: () => scope.layout.selectPanel('plugins'),
            }),
          }, PluginManagerAction))
        })
        ctx.slots.inject('settings.launcher', () => ctx.slots.register({
          name: 'settings.launcher', priority: -1, locale: 'open-waifu.shell',
        }, SettingsLauncher))

        if (tauri) {
          // DSH's layout reserves a Windows-style title row under these two
          // values; the row's buttons are ours, since the window has no frame.
          const html = document.documentElement
          html.setAttribute('data-windows-titlebar', '')
          html.style.setProperty('--dsh-windows-titlebar-height', '40px')
          ctx.effect(() => () => {
            html.removeAttribute('data-windows-titlebar')
            html.style.removeProperty('--dsh-windows-titlebar-height')
          }, 'open-waifu-shell: title row')
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ow-titlebar', order: 100 }, TitleBar))
        }
      },
    }
  },
})
