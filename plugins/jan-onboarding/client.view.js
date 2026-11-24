window.__ModuleLoader__.load({
  id: '@janhq/jan-onboarding',
  chunk: 'client.view.js',
  factory(require) {
    const { createElement: h, Fragment, useEffect, useRef, useState } = require('react')
    const {
      Button, Checkbox, Input,
      IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconGoalOutlineRegular,
      IconPanelLeftOutlineRegular, IconPluginPinwheelOutlineRegular, IconSearchOutlineRegular, IconShieldOutlineRegular, IconSlidersTwoOutlineRegular, IconSparkleRegular, IconUserOutlineRegular,
    } = require('@janhq/jan-client-ui-primitives')

    // The flow wears the main window's shell: a floating sidebar card listing the steps as nav
    // rows, and a content column on the base surface with composer-card material for choices.
    const css = `
.jan-onboarding {
  --ob-ease: var(--ds-ease-emphasized, cubic-bezier(0.22, 1, 0.36, 1));
  --ob-state: var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
  --ob-enter: var(--ds-transition-duration-slow, 300ms);
  --ob-exit: var(--ds-transition-duration, 200ms);
  --ob-select: var(--ds-transition-duration-fast, 100ms);
  --ob-rise: 6px;
  --ob-gap: var(--jt-sidebar-gap, 11px);
  --ob-row: 32px;
  --ob-row-pitch: 36px;
  --ob-accent: var(--dsw-alias-state-business-primary);
  --jan-onboarding-heading-font: 'StudioFeixenSans', 'Inter', sans-serif;
  display: grid;
  grid-template-columns: 229px minmax(0, 1fr);
  flex: 1;
  min-height: 100%;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  background: var(--dsw-alias-bg-base);
}
.jan-onboarding button { -webkit-app-region: no-drag; }
.jan-onboarding-rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: var(--ob-gap) 0 var(--ob-gap) var(--ob-gap);
  padding: 52px 9px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--jt-sidebar-radius, 20px);
  background: var(--dsw-alias-bg-base);
  animation: jan-onboarding-fade var(--ob-enter) var(--ob-ease) both;
}
.jan-onboarding-rail-label { margin: 0 0 6px; padding: 0 8px; font-size: 12px; line-height: 18px; font-weight: 500; color: color-mix(in srgb, var(--dsw-alias-label-primary) 70%, transparent); font-variant-numeric: tabular-nums; }
.jan-onboarding-steps { position: relative; display: grid; gap: calc(var(--ob-row-pitch) - var(--ob-row)); margin: 0; padding: 0; list-style: none; }
.jan-onboarding-steps-indicator {
  position: absolute; inset: 0 0 auto; height: var(--ob-row); border-radius: 8px;
  background: var(--dsw-specific-sidebar-nav-item-active, rgb(0 0 0 / 6%));
  transform: translateY(calc(var(--at) * var(--ob-row-pitch)));
  transition: transform var(--ds-transition-duration, 200ms) var(--ob-state);
}
.jan-onboarding-nav {
  position: relative; display: flex; align-items: center; gap: 8px; width: 100%; height: var(--ob-row); padding: 0 10px 0 8px; box-sizing: border-box;
  border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: start; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-state), color var(--ob-select) var(--ob-state);
}
.jan-onboarding-nav > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jan-onboarding-nav > svg { flex: none; color: color-mix(in srgb, currentColor 70%, transparent); }
.jan-onboarding-nav[data-state='done'] > svg { color: var(--ob-accent); animation: jan-onboarding-pop var(--ds-transition-duration, 200ms) var(--ob-ease) both; }
.jan-onboarding-nav[data-state='next'] { color: var(--dsw-alias-label-tertiary); cursor: default; }
.jan-onboarding-nav[data-state='current'] { cursor: default; }
.jan-onboarding-nav:disabled { cursor: default; }
@media (hover: hover) {
  .jan-onboarding-nav:not(:disabled):hover { background: var(--dsw-specific-sidebar-nav-item-hover, rgb(0 0 0 / 4%)); }
}
.jan-onboarding-nav:focus-visible, .jan-onboarding-chip:focus-visible, .jan-onboarding-default:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ob-accent)); outline-offset: 1px; }
.jan-onboarding-rail-note { margin: 12px 0 0; padding: 0 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.jan-onboarding-skip { margin-top: auto; }
/* Each step sits in the optical middle of the window (a little above true centre); a step taller
 * than the window starts at the top and scrolls. */
.jan-onboarding-main {
  position: relative; display: grid; place-items: center; min-width: 0; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: calc(var(--jan-frame-top-clearance, 0px) + 16px) clamp(24px, 6vw, 72px) 32px;
  background: radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, var(--ob-accent) 9%, transparent), transparent 70%),
    radial-gradient(50% 40% at 85% 100%, color-mix(in srgb, #FFC928 6%, transparent), transparent 70%);
}
.jan-onboarding-step { position: relative; display: grid; align-content: start; gap: 20px; width: min(100%, 600px); margin-bottom: 6vh; }
.jan-onboarding-step[data-exit] { animation: jan-onboarding-out var(--ob-exit) var(--ds-ease-in, cubic-bezier(0.4, 0, 1, 1)) both; }
.jan-onboarding[data-splash] .jan-onboarding-step { margin-bottom: 0; }
/* Start screen: no rail, one centred column. The mark is the biggest thing on it, the tagline says
 * what Jan is in one line, and a single pill leads in; skipping stays available but quiet. */
.jan-onboarding[data-splash] { grid-template-columns: minmax(0, 1fr); }
.jan-onboarding[data-splash] .jan-onboarding-main { place-items: center; padding-top: calc(var(--jan-frame-top-clearance, 0px) + 16px); }
.jan-onboarding-splash { display: grid; justify-items: center; gap: 20px; text-align: center; padding-bottom: 6vh; }
.jan-onboarding-mark { display: flex; align-items: center; gap: 20px; margin: 0; font-family: var(--jan-onboarding-heading-font); font-size: 72px; line-height: 80px; font-weight: 500; letter-spacing: -2px; outline: none; }
.jan-onboarding-mark img { width: 76px; height: 76px; flex: none; transform-origin: 70% 85%; animation: jan-onboarding-wave 1.1s var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)) 360ms both; }
.jan-onboarding-tagline { max-width: 40ch; margin: 0; font-size: 22px; line-height: 30px; color: var(--dsw-alias-label-primary); text-wrap: balance; white-space: pre-line; }
.jan-onboarding-splash-actions { display: grid; justify-items: center; gap: 12px; margin-top: 16px; }
.jan-onboarding .jan-onboarding-cta { height: 44px; padding: 0 22px 0 26px; gap: 6px; border-radius: 999px; font-size: 16px; }
.jan-onboarding-cta > svg { transition: transform var(--ob-select) var(--ob-state); }
@media (hover: hover) { .jan-onboarding-cta:not(:disabled):hover > svg { transform: translateX(2px); } }
.jan-onboarding-splash-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.jan-onboarding-heading h1 { margin: 0; font-family: var(--jan-onboarding-heading-font); font-size: 24px; line-height: 32px; font-weight: 500; letter-spacing: -0.2px; outline: none; }
.jan-onboarding-heading p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); }
.jan-onboarding-name { display: grid; gap: 8px; }
.jan-onboarding fieldset { min-width: 0; border: 0; margin: 0; padding: 0; }
.jan-onboarding legend, .jan-onboarding-name > span { margin: 0 0 8px; padding: 0; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.jan-onboarding-name > span { margin: 0; }
.jan-onboarding-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.jan-onboarding-chip {
  min-height: 32px; padding: 5px 14px; box-sizing: border-box; border: 0; border-radius: 999px;
  background: var(--dsw-specific-input-major); box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary); font: inherit; text-align: center; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-state), box-shadow var(--ob-select) var(--ob-state);
}
@media (hover: hover) {
  .jan-onboarding-chip:not(:disabled):hover { background: linear-gradient(var(--dsw-alias-interactive-bg-hover), var(--dsw-alias-interactive-bg-hover)), var(--dsw-specific-input-major); }
}
.jan-onboarding-chip[aria-pressed='true'] {
  background: color-mix(in srgb, var(--ob-accent) 10%, var(--dsw-specific-input-major));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ob-accent) 60%, transparent);
}
.jan-onboarding-chip:disabled { opacity: 0.45; cursor: default; }
.jan-onboarding-group { overflow: hidden; border-radius: var(--dsw-radius-lg, 16px); background: var(--dsw-specific-input-major); box-shadow: var(--dsw-elevation-soft); }
.jan-onboarding-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 12px; padding: 12px 14px; }
.jan-onboarding-row + .jan-onboarding-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.jan-onboarding-row > :first-child { grid-column: 1; }
.jan-onboarding-row p { grid-column: 1; margin: 0; padding-inline-start: 26px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.jan-onboarding-row .jan-onboarding-default { grid-column: 2; grid-row: 1 / span 2; }
.jan-onboarding-default {
  height: 26px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-state), color var(--ob-select) var(--ob-state);
}
@media (hover: hover) {
  .jan-onboarding-default:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.jan-onboarding-default[aria-pressed='true'] { background: color-mix(in srgb, var(--ob-accent) 12%, transparent); color: var(--ob-accent); cursor: default; }
.jan-onboarding-hint, .jan-onboarding-status { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.jan-onboarding-list { display: grid; gap: 16px; }
.jan-onboarding-routes { display: grid; gap: 10px; }
.jan-onboarding-route {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 12px; width: 100%; padding: 14px 16px; box-sizing: border-box;
  border: 0; border-radius: var(--dsw-radius-lg, 16px); background: var(--dsw-specific-input-major); box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary); font: inherit; text-align: start; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-state), box-shadow var(--ob-select) var(--ob-state);
}
@media (hover: hover) {
  .jan-onboarding-route:not(:disabled):hover { background: linear-gradient(var(--dsw-alias-interactive-bg-hover), var(--dsw-alias-interactive-bg-hover)), var(--dsw-specific-input-major); }
  .jan-onboarding-route-key:not(:disabled):hover { color: var(--dsw-alias-label-primary); }
}
.jan-onboarding-route[aria-checked='true'] {
  background: color-mix(in srgb, var(--ob-accent) 8%, var(--dsw-specific-input-major));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ob-accent) 60%, transparent);
}
.jan-onboarding-route:disabled, .jan-onboarding-route-key:disabled { opacity: 0.45; cursor: default; }
.jan-onboarding-route-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: color-mix(in srgb, var(--ob-accent) 12%, transparent); color: var(--ob-accent); }
.jan-onboarding-route-text { display: grid; gap: 2px; min-width: 0; }
.jan-onboarding-route-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-weight: 500; line-height: 20px; }
.jan-onboarding-route-detail { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.jan-onboarding-route-reason { color: var(--ob-accent); font-size: 12px; line-height: 18px; }
.jan-onboarding-badge { padding: 0 8px; border-radius: 999px; background: color-mix(in srgb, var(--ob-accent) 14%, transparent); color: var(--ob-accent); font-size: 11px; line-height: 18px; font-weight: 500; }
.jan-onboarding-route-check { display: grid; place-items: center; width: 20px; height: 20px; margin-top: 6px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l3); color: #fff; }
.jan-onboarding-route[aria-checked='true'] .jan-onboarding-route-check { background: var(--ob-accent); box-shadow: none; }
.jan-onboarding-route-key {
  justify-self: start; display: inline-flex; align-items: center; gap: 6px; margin-inline-start: -10px; padding: 4px 10px; border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 18px; cursor: pointer;
}
.jan-onboarding-route-key[aria-checked='true'] { color: var(--ob-accent); }
.jan-onboarding-models { display: grid; gap: 8px; margin-top: -2px; padding: 12px; border-radius: var(--dsw-radius-lg, 16px); background: var(--dsw-specific-input-major); box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2); }
.jan-onboarding-models input::placeholder { color: var(--dsw-alias-label-tertiary); }
.jan-onboarding-model-list { display: grid; max-height: 232px; overflow-y: auto; }
.jan-onboarding-model {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0 12px; padding: 8px 10px; border: 0; border-radius: 10px;
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: start; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-state);
}
@media (hover: hover) { .jan-onboarding-model:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); } }
.jan-onboarding-model[aria-checked='true'] { background: color-mix(in srgb, var(--ob-accent) 10%, transparent); }
.jan-onboarding-model > svg { grid-column: 2; grid-row: 1 / span 2; color: var(--ob-accent); }
.jan-onboarding-model-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jan-onboarding-model-meta { grid-column: 1; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jan-onboarding-model-meta[data-fit='too-large'] { color: var(--dsw-alias-label-error, #d93f3f); }
/* Back is a ghost button nested into the corner: its label, not its box, sits on the text line. */
.jan-onboarding-actions { display: flex; align-items: center; gap: 8px; }
.jan-onboarding-actions > :first-child:not(.jan-onboarding-primary) { margin-inline-start: -14px; }
.jan-onboarding-primary { margin-inline-start: auto; min-width: 120px; }
.jan-onboarding-step[data-step='detail'] .jan-onboarding-actions { position: absolute; inset: auto auto 0 0; }
.jan-onboarding-alert { position: absolute; inset: auto 0 24px; display: flex; justify-content: center; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.jan-onboarding [data-back] { --ob-rise: -6px; }
.jan-onboarding :is([data-enter], [data-onboarding-entrance]) { animation: jan-onboarding-in var(--ob-enter) var(--ob-ease) both; }
.jan-onboarding :is([data-enter='description'], [data-onboarding-entrance='description']) { animation-delay: 40ms; }
.jan-onboarding :is([data-enter='body'], [data-onboarding-entrance='body']) { animation-delay: 80ms; }
.jan-onboarding [data-enter='item'] { animation-delay: calc(80ms + min(var(--i) * 20ms, 120ms)); }
.jan-onboarding :is([data-enter='action'], [data-onboarding-entrance='action']) { animation-delay: 120ms; }
@keyframes jan-onboarding-in { from { opacity: 0; transform: translateY(var(--ob-rise)); } }
@keyframes jan-onboarding-out { to { opacity: 0; } }
@keyframes jan-onboarding-fade { from { opacity: 0; } }
@keyframes jan-onboarding-pop { from { transform: scale(0.6); opacity: 0; } }
@keyframes jan-onboarding-wave { 0%, 100% { transform: rotate(0); } 15% { transform: rotate(14deg); } 30% { transform: rotate(-8deg); } 45% { transform: rotate(14deg); } 60% { transform: rotate(-4deg); } 75% { transform: rotate(10deg); } }
/* The first question as a character select: two cards with a lit stage each. Assistant shows a squad
 * of bots, Workspace a small desk that assembles itself; choosing one lifts it and dims the other. */
.jan-onboarding-step[data-step='mode'] { width: min(100%, 760px); }
.jan-onboarding-picks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.jan-onboarding-pick {
  --pick-accent: var(--ob-accent);
  position: relative; display: grid; grid-template-rows: auto 1fr; min-width: 0; padding: 0; overflow: hidden; box-sizing: border-box;
  border: 0; border-radius: var(--dsw-radius-xl, 20px); background: var(--dsw-specific-input-major);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2), var(--dsw-elevation-soft);
  color: var(--dsw-alias-label-primary); font: inherit; text-align: start; cursor: pointer;
  transition: transform var(--ds-transition-duration, 200ms) var(--ob-ease), box-shadow var(--ds-transition-duration, 200ms) var(--ob-state),
    opacity var(--ds-transition-duration, 200ms) var(--ob-state), filter var(--ds-transition-duration, 200ms) var(--ob-state);
}
.jan-onboarding-pick[data-kind='workspace'] { --pick-accent: color-mix(in srgb, var(--ob-accent) 55%, #7C5CFF); }
@media (hover: hover) {
  .jan-onboarding-pick:not(:disabled):hover { transform: translateY(-3px); }
  .jan-onboarding-picks[data-chosen] .jan-onboarding-pick[aria-checked='false']:not(:disabled):hover { opacity: 1; filter: none; }
}
.jan-onboarding-pick:active:not(:disabled) { transform: translateY(-1px) scale(0.99); }
.jan-onboarding-pick:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ob-accent)); outline-offset: 2px; }
.jan-onboarding-pick[aria-checked='true'] {
  transform: translateY(-4px);
  box-shadow: inset 0 0 0 2px var(--pick-accent), 0 18px 40px -18px color-mix(in srgb, var(--pick-accent) 70%, transparent);
}
.jan-onboarding-picks[data-chosen] .jan-onboarding-pick[aria-checked='false'] { opacity: 0.6; filter: saturate(0.35); }
.jan-onboarding-pick:disabled { cursor: default; }
.jan-onboarding-stage {
  position: relative; display: grid; place-items: end center; height: 176px; padding-bottom: 26px; box-sizing: border-box; overflow: hidden;
  background: radial-gradient(55% 60% at 50% 100%, color-mix(in srgb, var(--pick-accent) 22%, transparent), transparent 72%),
    linear-gradient(color-mix(in srgb, var(--pick-accent) 7%, transparent), transparent);
}
/* A spotlight from above and a lit floor; both brighten on the chosen card. */
.jan-onboarding-stage::before {
  content: ''; position: absolute; inset: -20% 18% 0; opacity: 0.35;
  background: conic-gradient(from 160deg at 50% 0%, transparent, color-mix(in srgb, var(--pick-accent) 28%, transparent) 20deg, transparent 40deg);
  transition: opacity var(--ds-transition-duration-slow, 300ms) var(--ob-state);
}
.jan-onboarding-stage::after {
  content: ''; position: absolute; inset: auto 14% 14px; height: 18px; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--pick-accent) 40%, transparent), transparent);
  opacity: 0.6; transition: opacity var(--ds-transition-duration-slow, 300ms) var(--ob-state);
}
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-stage::before, .jan-onboarding-pick[aria-checked='true'] .jan-onboarding-stage::after { opacity: 1; }
.jan-onboarding-pick-check {
  position: absolute; top: 12px; inset-inline-end: 12px; z-index: 1; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l3); background: color-mix(in srgb, var(--dsw-specific-input-major) 70%, transparent); color: #fff;
}
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-pick-check {
  background: var(--pick-accent); box-shadow: none; animation: jan-onboarding-pop var(--ds-transition-duration, 200ms) var(--ob-ease) both;
}
.jan-onboarding-sparkle {
  position: absolute; width: 12px; height: 12px; color: var(--pick-accent); opacity: 0; transform: scale(0.4);
  transition: opacity var(--ds-transition-duration, 200ms) var(--ob-state), transform var(--ds-transition-duration, 200ms) var(--ob-ease);
}
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-sparkle {
  opacity: 1; transform: none;
  animation: jan-onboarding-twinkle var(--ds-transition-duration-ambient, 2s) var(--ds-ease-pulse, cubic-bezier(0.36, 0, 0.64, 1)) infinite;
  animation-delay: calc(var(--i) * var(--ds-transition-duration-slow, 300ms));
}
.jan-onboarding-squad { position: relative; display: flex; align-items: flex-end; gap: 4px; }
.jan-onboarding-bot { position: relative; width: var(--size); height: var(--size); }
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-bot {
  animation: jan-onboarding-hop calc(var(--ds-transition-duration-slow, 300ms) * 2) var(--ob-ease) both;
  animation-delay: calc(var(--i) * var(--ds-transition-duration-fast, 100ms) * 0.6);
}
.jan-onboarding-bot::after {
  content: ''; position: absolute; inset: auto 18% -6px; height: 6px; border-radius: 50%; background: rgb(0 0 0 / 18%);
  animation: jan-onboarding-shadow calc(var(--ds-transition-duration-ambient, 2s) * 1.2) var(--ds-ease-pulse, cubic-bezier(0.36, 0, 0.64, 1)) infinite;
  animation-delay: calc(var(--i) * var(--ds-transition-duration-slow, 300ms) * -1.4);
}
.jan-onboarding-bot svg {
  display: block; width: 100%; height: 100%; overflow: visible;
  animation: jan-onboarding-bob calc(var(--ds-transition-duration-ambient, 2s) * 1.2) var(--ds-ease-pulse, cubic-bezier(0.36, 0, 0.64, 1)) infinite;
  animation-delay: calc(var(--i) * var(--ds-transition-duration-slow, 300ms) * -1.4);
}
.jan-onboarding-bot-body { fill: var(--color); }
.jan-onboarding-bot-shine { fill: #fff; opacity: 0.22; }
/* Eyes follow the pointer: Squad writes --gx/--gy (SVG units) on each bot from its own centre. */
.jan-onboarding-bot-gaze { transform: translate(var(--gx, 0px), var(--gy, 0px)); transition: transform var(--ds-transition-duration-fast, 100ms) var(--ds-ease-out, cubic-bezier(0.23, 1, 0.32, 1)); }
.jan-onboarding-bot-eyes {
  transform-box: fill-box; transform-origin: center;
  animation: jan-onboarding-blink calc(var(--ds-transition-duration-ambient, 2s) * 2.2) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)) infinite;
  animation-delay: calc(var(--i) * var(--ds-transition-duration-loop, 1s) * -0.7);
}
.jan-onboarding-bot-eye { fill: #17171c; }
.jan-onboarding-bot-glint { fill: #fff; }
.jan-onboarding-bot-happy { fill: none; stroke: #17171c; stroke-width: 3.5; stroke-linecap: round; opacity: 0; }
.jan-onboarding-bot-open, .jan-onboarding-bot-happy { transition: opacity var(--ds-transition-duration-fast, 100ms) var(--ob-state); }
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-bot-open { opacity: 0; }
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-bot-happy { opacity: 1; }
.jan-onboarding-desk {
  position: relative; display: grid; grid-template-rows: 14px 1fr; width: min(78%, 236px); height: 128px; box-sizing: border-box; overflow: hidden;
  border-radius: 12px; background: var(--dsw-alias-bg-base); box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2), 0 12px 28px -16px rgb(0 0 0 / 45%);
  animation: jan-onboarding-bob calc(var(--ds-transition-duration-ambient, 2s) * 1.6) var(--ds-ease-pulse, cubic-bezier(0.36, 0, 0.64, 1)) infinite;
}
.jan-onboarding-desk-bar { display: flex; align-items: center; gap: 3px; padding: 0 7px; }
.jan-onboarding-desk-bar i { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-border-l3); }
.jan-onboarding-desk-bar i:first-child { background: #FF6159; }
.jan-onboarding-desk-bar i:nth-child(2) { background: #FFC130; }
.jan-onboarding-desk-bar i:nth-child(3) { background: #27C840; }
.jan-onboarding-desk-body { display: grid; grid-template-columns: 30% 1fr; gap: 5px; min-height: 0; padding: 0 6px 6px; }
.jan-onboarding-desk-side { position: relative; display: grid; align-content: start; gap: 4px; padding: 4px; border-radius: 7px; background: var(--dsw-specific-input-major); }
.jan-onboarding-desk-side::before {
  content: ''; position: absolute; inset: 4px 4px auto; height: 9px; border-radius: 4px; background: color-mix(in srgb, var(--pick-accent) 24%, transparent);
  animation: jan-onboarding-cursor calc(var(--ds-transition-duration-ambient, 2s) * 3) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)) infinite;
}
.jan-onboarding-desk-row { position: relative; height: 9px; border-radius: 4px; background: linear-gradient(90deg, var(--dsw-alias-border-l3) 9px, transparent 9px 12px, var(--dsw-alias-border-l2) 12px); }
.jan-onboarding-desk-main { display: grid; grid-template-columns: 1.4fr 1fr; grid-template-rows: 1fr auto; gap: 5px; min-height: 0; }
.jan-onboarding-desk-tile {
  display: grid; align-content: start; gap: 4px; min-width: 0; padding: 5px; border-radius: 7px; background: var(--dsw-specific-input-major);
  transition: background-color var(--ds-transition-duration, 200ms) var(--ob-state);
}
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-desk-tile {
  background: color-mix(in srgb, var(--pick-accent) 12%, var(--dsw-specific-input-major));
  animation: jan-onboarding-pop var(--ds-transition-duration-slow, 300ms) var(--ob-ease) both;
  animation-delay: calc(var(--i) * var(--ds-transition-duration-fast, 100ms) * 0.8);
}
.jan-onboarding-desk-code { grid-row: 1 / span 2; }
.jan-onboarding-desk-line {
  height: 4px; width: var(--w); border-radius: 2px; background: color-mix(in srgb, var(--c, var(--pick-accent)) 70%, transparent); transform-origin: left center;
  animation: jan-onboarding-type calc(var(--ds-transition-duration-ambient, 2s) * 2) var(--ds-ease-out, cubic-bezier(0.23, 1, 0.32, 1)) infinite;
  animation-delay: calc(var(--i) * var(--ds-transition-duration-slow, 300ms));
}
.jan-onboarding-desk-term { background: #17171c; color: #6EE7A8; font: 600 8px/10px ui-monospace, monospace; }
.jan-onboarding-desk-term span::after {
  content: ''; display: inline-block; width: 4px; height: 8px; margin-inline-start: 2px; vertical-align: -1px; background: currentColor;
  animation: jan-onboarding-caret var(--ds-transition-duration-loop, 1s) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)) infinite;
}
.jan-onboarding-desk-plugins { grid-template-columns: repeat(3, 1fr); align-content: center; }
.jan-onboarding-desk-plugins i { aspect-ratio: 1; border-radius: 4px; background: var(--c); }
.jan-onboarding-pick-text { display: grid; align-content: start; gap: 6px; padding: 14px 16px 16px; }
.jan-onboarding-pick-title { font-family: var(--jan-onboarding-heading-font); font-size: 18px; line-height: 24px; font-weight: 500; }
.jan-onboarding-pick-detail { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.jan-onboarding-stats { display: grid; gap: 5px; margin: 6px 0 0; }
.jan-onboarding-stat { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.jan-onboarding-stat-label { min-width: 0; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.jan-onboarding-pips { display: flex; gap: 3px; }
.jan-onboarding-pip { width: 14px; height: 6px; border-radius: 3px; background: var(--dsw-alias-border-l2); transform-origin: left center; }
.jan-onboarding-pip[data-on] {
  background: var(--pick-accent);
  animation: jan-onboarding-fill var(--ds-transition-duration-slow, 300ms) var(--ob-ease) both;
  animation-delay: calc(var(--ds-transition-duration-slow, 300ms) + var(--p) * var(--ds-transition-duration-fast, 100ms) * 0.6);
}
.jan-onboarding-pick[aria-checked='true'] .jan-onboarding-pip[data-on] { box-shadow: 0 0 8px color-mix(in srgb, var(--pick-accent) 60%, transparent); }
@keyframes jan-onboarding-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes jan-onboarding-shadow { 0%, 100% { transform: scaleX(1); opacity: 1; } 50% { transform: scaleX(0.8); opacity: 0.6; } }
@keyframes jan-onboarding-hop { 0% { transform: translateY(0) scale(1); } 25% { transform: translateY(2px) scale(1.06, 0.92); } 55% { transform: translateY(-18px) scale(0.96, 1.05); } 80% { transform: translateY(0) scale(1.04, 0.96); } 100% { transform: none; } }
@keyframes jan-onboarding-blink { 0%, 90%, 100% { transform: scaleY(1); } 94% { transform: scaleY(0.1); } }
@keyframes jan-onboarding-twinkle { 0%, 100% { transform: scale(1) rotate(0); opacity: 1; } 50% { transform: scale(0.5) rotate(45deg); opacity: 0.4; } }
@keyframes jan-onboarding-cursor { 0%, 20% { transform: translateY(0); } 33%, 53% { transform: translateY(13px); } 66%, 86% { transform: translateY(26px); } 100% { transform: translateY(0); } }
@keyframes jan-onboarding-type { 0% { transform: scaleX(0); } 30%, 85% { transform: scaleX(1); } 100% { transform: scaleX(1); opacity: 0; } }
@keyframes jan-onboarding-caret { 0%, 45% { opacity: 1; } 50%, 95% { opacity: 0; } }
@keyframes jan-onboarding-fill { from { transform: scaleX(0); } }
@media (max-width: 840px) and (min-width: 721px), (max-width: 560px) {
  .jan-onboarding-picks { grid-template-columns: minmax(0, 1fr); }
  .jan-onboarding-stage { height: 148px; padding-bottom: 20px; }
  .jan-onboarding-desk { height: 112px; }
}
@media (max-width: 720px) {
  .jan-onboarding { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .jan-onboarding-rail { flex-direction: row; align-items: center; justify-content: space-between; margin: var(--ob-gap); padding: calc(var(--jan-frame-top-clearance, 0px) + 4px) 9px 4px; }
  .jan-onboarding-steps, .jan-onboarding-rail-note { display: none; }
  .jan-onboarding-rail-label { margin: 0; }
  .jan-onboarding-skip { width: auto; margin: 0; }
  .jan-onboarding-main { padding-top: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .jan-onboarding :is(.jan-onboarding-rail, [data-enter], [data-onboarding-entrance], .jan-onboarding-mark img, .jan-onboarding-nav > svg), .jan-onboarding-step[data-exit] { animation: none; }
  .jan-onboarding-cta > svg { transition: none; }
  .jan-onboarding :is(.jan-onboarding-steps-indicator, .jan-onboarding-nav, .jan-onboarding-chip, .jan-onboarding-default, .jan-onboarding-route) { transition: none; }
  .jan-onboarding :is(.jan-onboarding-bot, .jan-onboarding-bot svg, .jan-onboarding-bot-eyes, .jan-onboarding-sparkle, .jan-onboarding-desk,
    .jan-onboarding-desk-tile, .jan-onboarding-desk-line, .jan-onboarding-pip, .jan-onboarding-pick-check),
  .jan-onboarding .jan-onboarding-bot::after, .jan-onboarding .jan-onboarding-desk-side::before, .jan-onboarding .jan-onboarding-desk-term span::after { animation: none; }
  .jan-onboarding :is(.jan-onboarding-pick, .jan-onboarding-pick:hover, .jan-onboarding-pick[aria-checked='true']) { transform: none; }
  .jan-onboarding :is(.jan-onboarding-pick, .jan-onboarding-bot-gaze) { transition: none; }
}
`

    // Assistant skips the questions that only tune the full workspace.
    const stepsFor = mode => mode === 'assistant' ? ['mode', 'about', 'model'] : ['mode', 'about', 'goals', 'detail', 'setup', 'model']
    const stepIcons = {
      mode: IconPanelLeftOutlineRegular, about: IconUserOutlineRegular, goals: IconGoalOutlineRegular,
      detail: IconSlidersTwoOutlineRegular, setup: IconPluginPinwheelOutlineRegular, model: IconSparkleRegular,
    }
    // The first question, as a character select: bot-first with a short sidebar, or every feature on screen.
    // Stats compare the two on a 1-5 scale; they describe the layout, not a limit on what either can do.
    const modes = [
      { id: 'assistant', title: 'modeAssistant', detail: 'modeAssistantDetail', stats: { autonomy: 5, simple: 5, power: 2 } },
      { id: 'workspace', title: 'modeWorkspace', detail: 'modeWorkspaceDetail', stats: { autonomy: 2, simple: 3, power: 5 } },
    ]
    // Bot silhouettes from jan-always-on's avatar set (Open Bot Avatar, MIT), so the squad looks like the bots users get.
    const squad = [
      { path: 'M50 12A38 38 0 1 1 50 88A38 38 0 1 1 50 12Z', eyes: 49, size: 58, color: '#FF7A59' },
      { path: 'M28 14H72C82 14 90 22 90 32V54C90 64 82 72 72 72H42L25 86C23.5 87.3 21.5 86 22.3 84L27 71.5C17 70 10 63 10 54V32C10 22 18 14 28 14Z', eyes: 42, size: 92, color: 'var(--ob-accent)' },
      { path: 'M30 14H70Q86 14 86 30V70Q86 86 70 86H30Q14 86 14 70V30Q14 14 30 14Z', eyes: 49, size: 70, color: '#7C5CFF' },
      { path: 'M40 22H60A28 28 0 0 1 60 78H40A28 28 0 0 1 40 22Z', eyes: 49, size: 50, color: '#FFC928' },
    ]
    const sparkles = [{ top: '22%', left: '14%' }, { top: '14%', left: '78%' }, { top: '46%', left: '88%' }, { top: '52%', left: '6%' }]
    const SPARKLE = 'M6 0C6.6 3.6 8.4 5.4 12 6C8.4 6.6 6.6 8.4 6 12C5.4 8.4 3.6 6.6 0 6C3.6 5.4 5.4 3.6 6 0Z'

    function Bot({ bot, i }) {
      const eye = x => h('g', { key: x }, h('ellipse', { className: 'jan-onboarding-bot-eye', cx: x, cy: bot.eyes, rx: 4.6, ry: 7 }),
        h('circle', { className: 'jan-onboarding-bot-glint', cx: x + 1.6, cy: bot.eyes - 2.6, r: 1.6 }))
      return h('span', { className: 'jan-onboarding-bot', style: { '--size': `${bot.size}px`, '--i': i, '--color': bot.color } },
        h('svg', { viewBox: '0 0 100 100', 'aria-hidden': true, focusable: false },
          h('path', { className: 'jan-onboarding-bot-body', d: bot.path }),
          h('ellipse', { className: 'jan-onboarding-bot-shine', cx: 34, cy: bot.eyes - 18, rx: 10, ry: 5, transform: `rotate(-20 34 ${bot.eyes - 18})` }),
          h('g', { className: 'jan-onboarding-bot-gaze' },
            h('g', { className: 'jan-onboarding-bot-eyes jan-onboarding-bot-open' }, eye(41), eye(59)),
            h('path', { className: 'jan-onboarding-bot-happy', d: `M36 ${bot.eyes + 2}Q41 ${bot.eyes - 5} 46 ${bot.eyes + 2}M54 ${bot.eyes + 2}Q59 ${bot.eyes - 5} 64 ${bot.eyes + 2}` }))))
    }

    // How far the eyes may travel inside the 100-unit body, and the pointer distance (px) that reaches it.
    const GAZE_X = 6
    const GAZE_Y = 4
    const GAZE_REACH = 160
    /** Bots that watch the pointer; one listener per squad, written straight to style so React never re-renders. */
    function Squad() {
      const ref = useRef(null)
      useEffect(() => {
        const squadNode = ref.current
        if (squadNode === null) return undefined
        let frame = 0
        let pointer = null
        const aim = () => {
          frame = 0
          for (const bot of squadNode.children) {
            let x = 0
            let y = 0
            if (pointer !== null) {
              const box = bot.getBoundingClientRect()
              const dx = pointer.x - (box.left + box.width / 2)
              const dy = pointer.y - (box.top + box.height / 2)
              const reach = Math.min(Math.hypot(dx, dy) / GAZE_REACH, 1)
              const angle = Math.atan2(dy, dx)
              x = Math.cos(angle) * reach * GAZE_X
              y = Math.sin(angle) * reach * GAZE_Y
            }
            bot.style.setProperty('--gx', `${x.toFixed(2)}px`)
            bot.style.setProperty('--gy', `${y.toFixed(2)}px`)
          }
        }
        const schedule = () => { if (frame === 0) frame = requestAnimationFrame(aim) }
        const move = (event) => {
          // Touch has no hovering pointer to follow; the eyes stay centred.
          if (event.pointerType === 'touch') return
          pointer = { x: event.clientX, y: event.clientY }
          schedule()
        }
        const leave = (event) => {
          if (event.relatedTarget !== null) return
          pointer = null
          schedule()
        }
        window.addEventListener('pointermove', move, { passive: true })
        document.addEventListener('pointerout', leave)
        return () => {
          window.removeEventListener('pointermove', move)
          document.removeEventListener('pointerout', leave)
          cancelAnimationFrame(frame)
        }
      }, [])
      return h('span', { ref, className: 'jan-onboarding-squad' }, squad.map((bot, i) => h(Bot, { key: i, bot, i })))
    }

    // Lines of the desk's code tile: width and an optional colour, like syntax highlighting.
    const codeLines = [{ w: '70%' }, { w: '88%', c: '#7C5CFF' }, { w: '52%', c: '#FF7A59' }, { w: '78%' }, { w: '40%', c: '#27C840' }]
    const pluginColors = ['#FF7A59', '#FFC928', '#7C5CFF', '#27C840', 'var(--ob-accent)', '#5AC8FA']
    function Desk() {
      return h('span', { className: 'jan-onboarding-desk', 'aria-hidden': true },
        h('span', { className: 'jan-onboarding-desk-bar' }, h('i'), h('i'), h('i')),
        h('span', { className: 'jan-onboarding-desk-body' },
          h('span', { className: 'jan-onboarding-desk-side' }, [0, 1, 2, 3, 4].map(i => h('span', { key: i, className: 'jan-onboarding-desk-row' }))),
          h('span', { className: 'jan-onboarding-desk-main' },
            h('span', { className: 'jan-onboarding-desk-tile jan-onboarding-desk-code', style: { '--i': 0 } }, codeLines.map((line, i) =>
              h('span', { key: i, className: 'jan-onboarding-desk-line', style: { '--w': line.w, '--i': i, ...line.c ? { '--c': line.c } : {} } }))),
            h('span', { className: 'jan-onboarding-desk-tile jan-onboarding-desk-term', style: { '--i': 1 } }, h('span', null, '$')),
            h('span', { className: 'jan-onboarding-desk-tile jan-onboarding-desk-plugins', style: { '--i': 2 } },
              pluginColors.map(color => h('i', { key: color, style: { '--c': color } }))))))
    }

    function ModeStage({ kind }) {
      return h('span', { className: 'jan-onboarding-stage', 'aria-hidden': true },
        sparkles.map((at, i) => h('svg', { key: i, className: 'jan-onboarding-sparkle', viewBox: '0 0 12 12', style: { ...at, '--i': i } },
          h('path', { d: SPARKLE, fill: 'currentColor' }))),
        kind === 'assistant' ? h(Squad) : h(Desk))
    }
    // The two ways to get a model shown as cards; an own API key stays a quiet link under them.
    const routes = [
      { id: 'account', title: 'modelAccount', detail: 'modelAccountDetail', Icon: IconSparkleRegular },
      { id: 'local', title: 'modelLocal', detail: 'modelLocalDetail', Icon: IconShieldOutlineRegular },
    ]
    // Jan's waving-hand mark, served by jan-theme; hidden if that plugin is absent.
    const LOGO = '/jan-theme/assets/jan-original.png'

    function createFlow({ roles, goalsFor, recommend, recommendModel, applySetup, applyAssistant }, operations) {
      return function OnboardingFlow({ t, busy, finish, retry, settingsError, renderFactorySlot }) {
        // Step -1 is the start screen: the mark, one line on what Jan is, and one way in.
        const [page, setPage] = useState({ step: -1, back: false })
        const [leaving, setLeaving] = useState(false)
        const [name, setName] = useState('')
        const [mode, setMode] = useState(null)
        const [selectedRoles, setRoles] = useState([])
        const [selectedGoals, setGoals] = useState([])
        const [detail, setDetail] = useState(null)
        const [catalog, setCatalog] = useState(null)
        const [catalogError, setCatalogError] = useState(false)
        const [setup, setSetup] = useState(null)
        const [working, setWorking] = useState(false)
        const [applyError, setApplyError] = useState(false)
        const [finalize, setFinalize] = useState(null)
        // null follows the recommendation, so changing earlier answers keeps it current.
        const [route, setRoute] = useState(null)
        // Local model picker: the Host's curated list, then Jan's public catalog once the user searches.
        const [curated, setCurated] = useState(null)
        const [hubRows, setHubRows] = useState(null)
        const [hubError, setHubError] = useState(false)
        const [query, setQuery] = useState('')
        const [localPick, setLocalPick] = useState(null)
        const heading = useRef(null)
        const section = useRef(null)
        const writing = useRef(false)
        // Bots enabled now (true) or after a restart (false); null until Assistant mode is applied.
        const botsReady = useRef(null)
        const disabled = busy || working || Boolean(leaving) || finalize !== null || settingsError
        // The rail follows a click at once, while the old step is still fading out.
        const shown = leaving ? leaving.step : page.step
        const steps = stepsFor(mode)
        const key = steps[page.step]
        useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [page])

        useEffect(() => {
          if (!leaving) return
          const animation = section.current.getAnimations().find(item => item.animationName === 'jan-onboarding-out')
          let live = true
          function finishIfHidden() {
            if (document.visibilityState === 'visible') return
            swap()
          }
          function swap() {
            if (!live) return
            live = false
            setPage(leaving)
            setLeaving(false)
          }
          const document = section.current.ownerDocument
          document.addEventListener('visibilitychange', finishIfHidden)
          if (document.visibilityState === 'hidden') swap()
          else void (animation?.finished ?? Promise.resolve()).then(swap, swap)
          return () => {
            live = false
            document.removeEventListener('visibilitychange', finishIfHidden)
          }
        }, [leaving])

        function move(step) {
          const next = { step, back: step < page.step }
          if (document.visibilityState === 'hidden' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPage(next)
          else setLeaving(next)
        }

        async function readCatalog() {
          setCatalogError(false)
          try { setCatalog(await operations.catalog()) }
          catch { setCatalogError(true) }
        }

        useEffect(() => {
          if (key === 'setup' && catalog === null && !catalogError) void readCatalog()
        }, [page.step])

        useEffect(() => {
          if (key !== 'model' || curated !== null || !operations.localAvailable()) return
          operations.localModels().then(setCurated, () => { setCurated({ budget: 0, models: [] }) })
        }, [page.step])

        function search(text) {
          setQuery(text)
          if (text.trim() === '' || hubRows !== null) return
          setHubError(false)
          operations.searchCatalog().then(setHubRows, () => { setHubError(true) })
        }

        const goals = goalsFor(selectedRoles)
        const options = catalog === null ? null : recommend(selectedRoles, catalog)
        const checked = setup ?? (options === null ? null : {
          modes: options.modes.map(option => option.id), plugins: options.plugins.map(option => option.id),
          defaultMode: options.modes[0]?.id ?? '',
        })
        const defaultMode = checked?.modes.includes(checked.defaultMode) ? checked.defaultMode : checked?.modes[0]
        const localAvailable = operations.localAvailable()
        const suggestion = recommendModel(selectedRoles, selectedGoals, localAvailable)
        // The suggested route is listed first; a route the build cannot run is not offered.
        const offered = routes.filter(item => item.id !== 'local' || localAvailable)
          .sort((a, b) => Number(b.id === suggestion.route) - Number(a.id === suggestion.route))
        const chosen = route !== null && (route === 'api-key' || offered.some(item => item.id === route)) ? route : suggestion.route
        const curatedModels = curated?.models ?? []
        const picked = localPick ?? curatedModels.find(model => model.recommended) ?? curatedModels[0]
        const terms = query.toLowerCase().match(/[\p{L}\p{N}.]+/gu) ?? []
        const matching = model => terms.every(term => `${model.name} ${model.detail} ${model.repo}`.toLowerCase().includes(term))
        // Curated models first, then the catalog's most downloaded matches; a curated repo is not listed twice.
        const listed = terms.length === 0 ? curatedModels : [
          ...curatedModels.filter(matching),
          ...(hubRows ?? []).filter(model => matching(model) && !curatedModels.some(entry => entry.repo === model.repo)),
        ].slice(0, 8)
        const fitOf = model => model.fit ?? (curated?.budget > 0 && model.bytes > curated.budget ? 'too-large' : undefined)
        const size = bytes => bytes > 0 ? `${(bytes / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB` : ''

        function toggleRole(role) {
          const next = selectedRoles.includes(role) ? selectedRoles.filter(item => item !== role) : [...selectedRoles, role]
          const available = goalsFor(next)
          setRoles(next)
          setGoals(selectedGoals.filter(goal => available.includes(goal)))
          setSetup(null)
        }

        // Assistant mode lands on Bots; the chosen model route then opens over it (a local chat replaces it).
        function connect() {
          if (botsReady.current === true) operations.openBots()
          operations.connect(chosen, picked)
        }

        async function submit(skip) {
          if (writing.current) return
          writing.current = true
          setWorking(true)
          setApplyError(false)
          try {
            if (finalize !== null) {
              if (!await retry()) setApplyError(true)
              else if (finalize === 'finish') connect()
              return
            }
            const profile = { name, roles: selectedRoles, goals: selectedGoals }
            if (!skip && mode === 'assistant') botsReady.current = await applyAssistant(operations, profile) === 'applied'
            else if (!skip) await applySetup(operations, profile, options, checked)
            setFinalize(skip ? 'skip' : 'finish')
            // Assistant has no detail question: it starts with the compact transcript, fewer things on screen.
            if (!await finish(skip ? null : mode === 'assistant' ? 'compact' : detail)) setApplyError(true)
            else if (!skip) connect()
          } catch {
            setApplyError(true)
          } finally {
            writing.current = false
            setWorking(false)
          }
        }

        // Back sits left and the step's primary action right, as one row under every step.
        const actions = primary => h('div', { className: 'jan-onboarding-actions', 'data-enter': 'action' },
          page.step > 0 && h(Button, { variant: 'ghost', disabled, onClick: () => { move(page.step - 1) } }, t('back')),
          primary && h(Button, { className: 'jan-onboarding-primary', variant: 'primary', disabled: disabled || primary.unavailable, onClick: primary.action }, t(primary.label)))
        const title = (titleKey, subtitle) => h('header', { className: 'jan-onboarding-heading' },
          h('h1', { id: 'jan-onboarding-title', ref: heading, tabIndex: -1, 'data-enter': '' }, t(titleKey)),
          h('p', { 'data-enter': 'description' }, t(subtitle)))
        const chips = (label, choices, prefix, picked, toggle, limit = choices.length) => h('fieldset', { 'data-enter': 'body' },
          h('legend', null, t(label)), h('div', { className: 'jan-onboarding-chips' }, choices.map((choice, i) => {
            const selected = picked.includes(choice)
            return h('button', {
              key: choice, type: 'button', className: 'jan-onboarding-chip', 'data-enter': 'item', style: { '--i': i },
              'aria-pressed': selected, disabled: disabled || (!selected && picked.length >= limit), onClick: () => { toggle(choice) },
            }, t(`${prefix}.${choice}`))
          })))
        const rows = (kind, items) => h('fieldset', { 'data-enter': 'body' },
          h('legend', null, t(kind)),
          h('div', { className: 'jan-onboarding-group' }, items.map(({ id, copy }) => h('div', { key: id, className: 'jan-onboarding-row' },
            h(Checkbox, { label: t(`item.${copy}`), checked: checked[kind].includes(id), disabled, onChange: value => {
              const next = value ? [...checked[kind], id] : checked[kind].filter(item => item !== id)
              setSetup({ ...checked, [kind]: next, defaultMode: kind === 'modes' && !next.includes(defaultMode) ? next[0] ?? '' : defaultMode ?? '' })
            } }),
            h('p', null, t(`why.${copy}`)),
            kind === 'modes' && checked.modes.includes(id) && h('button', {
              type: 'button', className: 'jan-onboarding-default', disabled, 'aria-pressed': defaultMode === id,
              'aria-label': `${t('makeDefault')}: ${t(`item.${copy}`)}`,
              onClick: () => { setSetup({ ...checked, defaultMode: id }) },
            }, t(defaultMode === id ? 'isDefault' : 'makeDefault'))))))

        let content
        if (page.step === -1) content = h('div', { className: 'jan-onboarding-splash' },
          h('h1', { id: 'jan-onboarding-title', ref: heading, tabIndex: -1, className: 'jan-onboarding-mark', 'aria-label': t('welcome'), 'data-enter': '' },
            h('img', { src: LOGO, alt: '', draggable: false, onError: event => { event.currentTarget.hidden = true } }), h('span', null, 'Jan')),
          h('p', { className: 'jan-onboarding-tagline', 'data-enter': 'description' }, t('tagline')),
          h('div', { className: 'jan-onboarding-splash-actions', 'data-enter': 'action' },
            h(Button, { className: 'jan-onboarding-cta', variant: 'primary', disabled, onClick: () => { move(0) } },
              t('getStarted'), h(IconChevronRightOutlineRegular, { size: 16 })),
            h('p', { className: 'jan-onboarding-splash-note' }, t('splashNote')),
            h(Button, { variant: 'ghost', size: 'sm', disabled, onClick: () => { void submit(true) } }, t('skip'))))
        else if (key === 'mode') content = h(Fragment, null,
          title('mode', 'modeHint'),
          h('div', { className: 'jan-onboarding-picks', role: 'radiogroup', 'aria-labelledby': 'jan-onboarding-title', 'data-enter': 'body', 'data-chosen': mode !== null || undefined },
            modes.map((item, i) => {
              const on = mode === item.id
              return h('button', {
                key: item.id, type: 'button', role: 'radio', 'aria-checked': on, className: 'jan-onboarding-pick', 'data-kind': item.id,
                'aria-labelledby': `jan-onboarding-pick-${item.id}`, 'aria-describedby': `jan-onboarding-pick-${item.id}-detail`,
                'data-enter': 'item', style: { '--i': i }, disabled, onClick: () => { setMode(item.id) },
              },
              h(ModeStage, { kind: item.id }),
              h('span', { className: 'jan-onboarding-pick-check', 'aria-hidden': true }, on && h(IconCheckOutlineRegular, { size: 14 })),
              h('span', { className: 'jan-onboarding-pick-text' },
                h('span', { id: `jan-onboarding-pick-${item.id}`, className: 'jan-onboarding-pick-title' }, t(item.title)),
                h('span', { id: `jan-onboarding-pick-${item.id}-detail`, className: 'jan-onboarding-pick-detail' }, t(item.detail)),
                h('span', { className: 'jan-onboarding-stats', 'aria-hidden': true }, Object.entries(item.stats).map(([stat, value]) =>
                  h('span', { key: stat, className: 'jan-onboarding-stat' },
                    h('span', { className: 'jan-onboarding-stat-label' }, t(`stat.${stat}`)),
                    h('span', { className: 'jan-onboarding-pips' }, [0, 1, 2, 3, 4].map(p =>
                      h('span', { key: p, className: 'jan-onboarding-pip', 'data-on': p < value || undefined, style: { '--p': p } }))))))))
            })),
          actions({ label: 'continue', action: () => { move(page.step + 1) }, unavailable: mode === null }))
        else if (key === 'about') content = h(Fragment, null,
          title('about', 'aboutHint'),
          h('label', { className: 'jan-onboarding-name', 'data-enter': 'body' }, h('span', null, t('name')),
            h(Input, { value: name, autoComplete: 'given-name', disabled, onChange: event => { setName(event.target.value) } })),
          chips('roles', roles, 'role', selectedRoles, toggleRole, 3),
          actions({ label: 'continue', action: () => { move(page.step + 1) }, unavailable: selectedRoles.length === 0 }))
        else if (key === 'goals') content = h(Fragment, null,
          title('goals', 'goalsHint'), chips('goalOptions', goals, 'goal', selectedGoals, goal => {
            setGoals(selectedGoals.includes(goal) ? selectedGoals.filter(item => item !== goal) : [...selectedGoals, goal])
          }), actions({ label: 'continue', action: () => { move(page.step + 1) } }))
        // The shared detail selector brings its own Continue; Back is laid over its action row.
        else if (key === 'detail') content = h(Fragment, null, renderFactorySlot('settings.onboarding.detail', {
          busy: disabled, process: detail, continueLabel: t('continue'), onSelect: setDetail, onContinue: () => { move(page.step + 1) },
        }), actions(null))
        else if (key === 'setup') content = h(Fragment, null, title('setup', 'setupHint'),
          options === null ? catalogError ? h('div', { className: 'jan-onboarding-status', role: 'alert' }, t('catalogError'), ' ',
            h(Button, { size: 'sm', disabled, onClick: () => { void readCatalog() } }, t('retry')))
            : h('p', { role: 'status', className: 'jan-onboarding-status' }, t('loading')) : h('div', { className: 'jan-onboarding-list' },
            options.modes.length > 0 && rows('modes', options.modes),
            options.plugins.length > 0 && rows('plugins', options.plugins),
            options.plugins.length === 0 && h('p', { className: 'jan-onboarding-hint', 'data-enter': 'body' }, t('noPlugins'))),
          actions({ label: 'continue', action: () => { move(page.step + 1) }, unavailable: options === null }))
        // Local is chosen: search the curated list and Jan's catalog, one row per model.
        const picker = () => h('div', { className: 'jan-onboarding-models', role: 'group', 'aria-label': t('modelPick') },
          h(Input, {
            type: 'search', value: query, placeholder: t('modelSearch'), 'aria-label': t('modelSearch'), disabled,
            icon: h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }), onChange: event => { search(event.target.value) },
          }),
          h('div', { className: 'jan-onboarding-model-list', role: 'radiogroup', 'aria-label': t('modelPick') },
            listed.map(model => {
              const fit = fitOf(model)
              const on = picked?.key === model.key
              return h('button', {
                key: model.key, type: 'button', role: 'radio', 'aria-checked': on, className: 'jan-onboarding-model', disabled,
                onClick: () => { setLocalPick(model) },
              },
              h('span', { className: 'jan-onboarding-model-name' }, model.name,
                model.installed && h('span', { className: 'jan-onboarding-badge' }, t('installed'))),
              h('span', { className: 'jan-onboarding-model-meta', 'data-fit': fit },
                [model.detail, size(model.bytes), fit && fit !== 'fits' ? t(`fit.${fit}`) : ''].filter(Boolean).join(' · ')),
              on && h(IconCheckOutlineRegular, { size: 14, 'aria-hidden': true }))
            })),
          curated === null ? h('p', { role: 'status', className: 'jan-onboarding-hint' }, t('loading'))
            : terms.length > 0 && hubError ? h('p', { role: 'alert', className: 'jan-onboarding-hint' }, t('modelSearchError'))
            : terms.length > 0 && hubRows === null ? h('p', { role: 'status', className: 'jan-onboarding-hint' }, t('loading'))
            : listed.length === 0 && h('p', { role: 'status', className: 'jan-onboarding-hint' }, t('modelSearchEmpty')))
        if (key === 'model') content = h(Fragment, null, title('model', 'modelHint'),
          h('div', { className: 'jan-onboarding-routes', role: 'radiogroup', 'aria-labelledby': 'jan-onboarding-title', 'data-enter': 'body' },
            offered.map((item, i) => {
              const on = chosen === item.id
              const suggested = item.id === suggestion.route
              return h(Fragment, { key: item.id }, h('button', {
                type: 'button', role: 'radio', 'aria-checked': on, className: 'jan-onboarding-route',
                'data-enter': 'item', style: { '--i': i }, disabled, onClick: () => { setRoute(item.id) },
              },
              h('span', { className: 'jan-onboarding-route-icon' }, h(item.Icon, { size: 18 })),
              h('span', { className: 'jan-onboarding-route-text' },
                h('span', { className: 'jan-onboarding-route-title' }, t(item.title),
                  suggested && h('span', { className: 'jan-onboarding-badge' }, t('recommended'))),
                h('span', { className: 'jan-onboarding-route-detail' },
                  item.id === 'local' && picked ? `${picked.name} · ${size(picked.bytes)} · ${t(item.detail)}` : t(item.detail)),
                suggested && h('span', { className: 'jan-onboarding-route-reason' }, t(`reason.${suggestion.reason}`))),
              h('span', { className: 'jan-onboarding-route-check', 'aria-hidden': true }, on && h(IconCheckOutlineRegular, { size: 14 }))),
              item.id === 'local' && on && picker())
            }),
            h('button', {
              type: 'button', role: 'radio', 'aria-checked': chosen === 'api-key', className: 'jan-onboarding-route-key', disabled,
              onClick: () => { setRoute('api-key') },
            }, chosen === 'api-key' && h(IconCheckOutlineRegular, { size: 14 }), t('modelKey'))),
          actions({ label: working && finalize === null ? 'working' : 'start', action: () => { void submit(false) }, unavailable: mode === 'workspace' && options === null }))

        return h('div', { className: 'jan-onboarding', 'data-splash': page.step === -1 || undefined, 'aria-busy': busy || working }, h('style', null, css),
          page.step >= 0 && h('nav', { className: 'jan-onboarding-rail', 'aria-labelledby': 'jan-onboarding-counter' },
            h('p', { id: 'jan-onboarding-counter', className: 'jan-onboarding-rail-label', 'aria-live': 'polite', 'aria-atomic': true },
              t('stepCounter', { step: shown + 1, total: steps.length })),
            h('ol', { className: 'jan-onboarding-steps', style: { '--at': shown } },
              h('span', { className: 'jan-onboarding-steps-indicator', 'aria-hidden': true }),
              steps.map((step, i) => {
                const state = i < shown ? 'done' : i === shown ? 'current' : 'next'
                const Icon = state === 'done' ? IconCheckOutlineRegular : stepIcons[step]
                return h('li', { key: step }, h('button', {
                  type: 'button', className: 'jan-onboarding-nav', 'data-state': state, 'aria-current': state === 'current' ? 'step' : undefined,
                  disabled: disabled || state !== 'done', onClick: () => { move(i) },
                }, h(Icon, { size: 16 }), h('span', null, t(`rail.${step}`))))
              })),
            h('p', { className: 'jan-onboarding-rail-note' }, t(`progress.${steps[shown]}`)),
            h('button', { type: 'button', className: 'jan-onboarding-nav jan-onboarding-skip', disabled, onClick: () => { void submit(true) } },
              h(IconChevronRightOutlineRegular, { size: 16 }), h('span', null, t('skip')))),
          h('main', { className: 'jan-onboarding-main' },
            h('section', { key: page.step, ref: section, className: 'jan-onboarding-step', 'data-step': key,
              'aria-labelledby': key === 'detail' ? 'desktop-onboarding-title' : 'jan-onboarding-title',
              'data-back': page.back || undefined, 'data-exit': leaving ? true : undefined }, content),
            (applyError || settingsError) && h('div', { role: 'alert', className: 'jan-onboarding-alert' }, t('saveError'),
              h(Button, { size: 'sm', disabled: busy || working, onClick: () => {
                if (finalize !== null || applyError) void submit(false)
                else void retry()
              } }, t('retry')))))
      }
    }
    return { createFlow }
  },
})
