// UI and motion regression for the Jan theme shell over the real Web
// composition: the sidebar's row rhythm and ink (Jan's sidebar values), the
// hover motion of each nav icon sampled mid-flight, reduced motion, the model
// menu's contributed rows, and the project page title avatar. Geometry,
// computed style and Web Animations state are compared instead of pixels, so
// the checks hold across platforms and font rasterizers.
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./jan-theme-shell.overlay.yml', import.meta.url))
const ANCHORS = ['jan-theme', 'model-hub']
  .map(name => fileURLToPath(new URL(`../../../plugins/${name}/package.json`, import.meta.url)))
const PROJECT = 'jt-shell'

/** Jan's sidebar ink (web-app index.css): label, 70% icon, muted shortcut. */
const INK = {
  light: { label: 'oklch(0.145 0 0)', icon: 'oklch(0.145 0 0 / 0.7)', muted: 'oklch(0.556 0 0)' },
  dark: { label: 'oklch(0.985 0 0)', icon: 'oklch(0.985 0 0 / 0.7)', muted: 'oklch(0.708 0 0)' },
}

const navRow = (page: Page, name: string): Locator => page.locator('[data-slot="sidebar"] .jt-nav-row', { hasText: name }).first()

/** The CSS animations and transitions running on the row's icon, with their timing. */
async function iconMotion(row: Locator) {
  return row.locator('.jt-nav-icon').evaluate(icon => icon.getAnimations().map((animation) => {
    const timing = animation.effect!.getComputedTiming()
    return {
      name: animation instanceof CSSAnimation ? animation.animationName : (animation as CSSTransition).transitionProperty,
      duration: timing.duration,
      iterations: timing.iterations,
    }
  }))
}

/**
 * Freeze the icon's hover animation at a fraction of its duration and read the pose.
 * @returns the rotation in degrees and translation in px the transform holds then.
 */
async function poseAt(row: Locator, progress: number) {
  return row.locator('.jt-nav-icon').evaluate((icon, at) => {
    const animation = icon.getAnimations().find(running => running instanceof CSSAnimation)!
    animation.pause()
    animation.currentTime = Number(animation.effect!.getComputedTiming().duration) * at
    const matrix = new DOMMatrixReadOnly(getComputedStyle(icon).transform)
    // `+ 0` folds -0 into 0, so a pose compares by value.
    const whole = (value: number) => Math.round(value) + 0
    return { rotate: whole(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI), x: whole(matrix.e), y: whole(matrix.f) }
  }, progress)
}

/** Hover a row from outside the sidebar, so each check starts a fresh hover entry. */
async function hoverFresh(page: Page, row: Locator): Promise<void> {
  await page.mouse.move(900, 900)
  await row.hover()
}

describe('web e2e: Jan theme shell', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: ANCHORS })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, PROJECT)
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps Jan\'s sidebar rhythm: 32px rows on a 36px pitch, 14px labels, 12px heading', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-jan-theme-sidebar-rhythm'))
    const [first, second] = await Promise.all(['New Chat', 'Search'].map(name => navRow(page, name).boundingBox()))
    expect({ height: first!.height, pitch: Math.round(second!.y - first!.y) }).toEqual({ height: 32, pitch: 36 })
    const type = await page.locator('[data-slot="sidebar"]').evaluate((sidebar) => {
      const font = (selector: string) => {
        const style = getComputedStyle(sidebar.querySelector(selector)!)
        return `${style.fontSize} ${style.fontWeight}`
      }
      return { label: font('.jt-nav-row'), heading: font('.jt-list-heading'), shortcut: font('.jt-nav-row [class*="shortcut"]') }
    })
    expect(type).toEqual({ label: '14px 400', heading: '12px 500', shortcut: '11px 400' })
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`paints the sidebar with Jan's ${scheme} label, icon and shortcut ink`, async () => {
      onTestFailed(() => saveFailureShot(page, `web-e2e-jan-theme-sidebar-ink-${scheme}`))
      await page.emulateMedia({ colorScheme: scheme })
      await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(scheme === 'dark')
      const ink = await navRow(page, 'New Chat').evaluate(row => ({
        label: getComputedStyle(row).color,
        icon: getComputedStyle(row.querySelector('.jt-nav-icon')!).color,
        muted: getComputedStyle(row.querySelector('[class*="shortcut"]')!).color,
      }))
      expect(ink).toEqual(INK[scheme])
    })
  }

  it('plays each nav icon\'s hover motion once, through its keyframes, and comes to rest', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-jan-theme-hover-motion'))
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    // Jan's animated-icon motions: a chat bubble wobble, a search glance, a box tilt.
    const cases = [
      { row: 'New Chat', name: 'jt-anim-chat', duration: 500, poses: [[1 / 3, { rotate: -7, x: 0, y: 0 }], [2 / 3, { rotate: 7, x: 0, y: 0 }]] },
      { row: 'Search', name: 'jt-anim-search', duration: 1000, poses: [[1 / 3, { rotate: 0, x: 0, y: -4 }], [2 / 3, { rotate: 0, x: -3, y: 0 }]] },
      { row: 'Models', name: 'jt-anim-box', duration: 450, poses: [[1 / 2, { rotate: -7, x: 0, y: 0 }]] },
    ] as const
    for (const { row: name, name: animationName, duration, poses } of cases) {
      const row = navRow(page, name)
      await hoverFresh(page, row)
      expect(await iconMotion(row), name).toEqual(expect.arrayContaining([{ name: animationName, duration, iterations: 1 }]))
      for (const [at, pose] of poses) expect(await poseAt(row, at), `${name} at ${at}`).toEqual(pose)
      await row.locator('.jt-nav-icon').evaluate(icon => icon.getAnimations().forEach(animation => animation.finish()))
      expect(await row.locator('.jt-nav-icon').evaluate(icon => getComputedStyle(icon).transform), `${name} at rest`).toBe('none')
    }
  })

  it('springs the Customize gear half a turn while hovered and back on leave', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-jan-theme-gear'))
    const row = navRow(page, 'Customize')
    const gear = row.locator('.jt-nav-icon')
    const settle = () => gear.evaluate(async (icon) => {
      await Promise.all(icon.getAnimations().map(animation => animation.finished))
      return getComputedStyle(icon).rotate
    })
    await hoverFresh(page, row)
    expect(await iconMotion(row)).toEqual([{ name: 'rotate', duration: 600, iterations: 1 }])
    expect(await settle()).toBe('180deg')
    await page.mouse.move(900, 900)
    expect(await settle()).toBe('none')
  })

  it('holds every nav icon still under reduced motion', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-jan-theme-reduced-motion'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    try {
      for (const name of ['New Chat', 'Search', 'Models', 'Customize']) {
        await hoverFresh(page, navRow(page, name))
        expect(await iconMotion(navRow(page, name)), name).toEqual([])
      }
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.mouse.move(900, 900)
    }
  })

  it('lines up the model menu\'s contributed rows with Manage models', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-jan-theme-model-menu'))
    await page.getByRole('button', { name: /^Select model/ }).click()
    const footer = page.getByRole('menu', { name: 'Model options' })
    await footer.waitFor()
    const rows = await footer.evaluate(menu => [...menu.querySelectorAll('button')].filter(row => row.textContent!.trim() !== '').map((row) => {
      const icon = row.querySelector('svg')!.getBoundingClientRect()
      const text = [...row.querySelectorAll('*')].find(node => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent!.trim() !== ''))!
      return {
        text: row.textContent!.trim(),
        height: row.getBoundingClientRect().height,
        icon: [Math.round(icon.left), Math.round(icon.width)],
        label: Math.round(text.getBoundingClientRect().left),
      }
    }))
    expect(rows.map(row => row.text)).toEqual(['Get local models', 'Sign in for free usage', 'Manage models…'])
    expect(new Set(rows.map(row => JSON.stringify([row.height, row.icon, row.label]))).size, JSON.stringify(rows)).toBe(1)
    await page.keyboard.press('Escape')
    await footer.waitFor({ state: 'detached' })
  })

  it('draws the project avatar left of the project title, centred on it, and opens the editor from it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-jan-theme-project-title'))
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Projects' }).click()
    await page.locator('.jt-projects').getByText(PROJECT, { exact: true }).first().click()
    const row = page.locator('.jt-project-title-row')
    await row.waitFor()
    const geometry = await row.evaluate((title) => {
      const box = (selector: string) => title.querySelector(selector)!.getBoundingClientRect()
      const avatar = box('.jt-project-avatar')
      const heading = box('.jt-project-title')
      const pencil = box('.jt-project-path-action')
      return {
        avatar: [avatar.width, avatar.height],
        order: avatar.right <= heading.left && heading.right <= pencil.left,
        centre: Math.round((avatar.top + avatar.height / 2) - (heading.top + heading.height / 2)),
      }
    })
    expect(geometry).toEqual({ avatar: [32, 32], order: true, centre: 0 })
    await row.locator('.jt-project-avatar').click()
    const dialog = page.getByRole('dialog', { name: 'Edit project' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached' })
  })
})
