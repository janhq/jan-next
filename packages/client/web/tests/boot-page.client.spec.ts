// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('draws the loading skeleton before any plugin state arrives', () => {
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-jan-boot')).toBe('')
    expect(el.textContent).toContain('Jan')
    expect(el.textContent).not.toContain('HARNESS')
    expect(el.textContent).toContain('Loading plugins…')
  })

  it('keeps loading while entries are active or loading', () => {
    const { el, page } = mount()
    page.setTotal(2)
    const progress = el.querySelector<HTMLElement>('[data-jan-boot-progress]')
    expect(progress?.style.getPropertyValue('--jan-boot-progress')).toBe('20%')
    page.setState('a', 'active')
    expect(progress?.style.getPropertyValue('--jan-boot-progress')).toBe('60%')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-jan-boot-progress]')).toBe(progress)
    page.setState('b', 'active')
    expect(progress?.style.getPropertyValue('--jan-boot-progress')).toBe('100%')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('lists failed entries', () => {
    const { el, page } = mount()
    page.setState('@janhq/jan-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@janhq/jan-client-ui-tool', 'failed')
    expect(el.textContent).toContain('@janhq/jan-client-ui-layout')
    expect(el.textContent).toContain('@janhq/jan-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('shows the complete sweep report', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
