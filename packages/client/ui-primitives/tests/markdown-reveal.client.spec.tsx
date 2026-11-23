// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStreamReveal } from '../src/markdown/reveal.tsx'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('streamed word reveal', () => {
  it('fades each new word once, and resumes rather than replays a word whose block froze', () => {
    const started: Array<{ word: string; at: number | null }> = []
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    HTMLElement.prototype.animate = function (this: HTMLElement): Animation {
      const animation = { currentTime: null as number | null, cancel: () => {} }
      started.push({ word: this.textContent, get at() { return animation.currentTime } })
      return animation as never
    }
    const reveal = createStreamReveal()
    const view = render(<MarkdownText text="Hello world" streaming reveal={reveal} />)
    expect([...view.container.querySelectorAll('[data-reveal]')].map(span => span.textContent)).toEqual(['Hello', 'world'])
    expect(started.map(run => run.word)).toEqual(['Hello', 'world'])

    // A new paragraph freezes the first: its words remount 200 ms later and pick up their fade there.
    vi.spyOn(performance, 'now').mockReturnValue(1200)
    started.length = 0
    view.rerender(<MarkdownText text={'Hello world\n\nNext **bold**'} streaming reveal={reveal} />)
    expect(started.filter(run => run.word === 'Next' || run.word === 'bold').map(run => run.at)).toEqual([0, 0])
    // The frozen paragraph keeps its spans, so its words do not replay.
    expect(started.filter(run => run.word === 'Hello')).toEqual([])
    // A real remount (the transcript row re-mounting) resumes each word where its fade had reached.
    view.unmount()
    const view2 = render(<MarkdownText text={'Hello world\n\nNext **bold**'} streaming reveal={reveal} />)
    expect(started.filter(run => run.word === 'Hello').map(run => run.at)).toEqual([200])

    // Long after, nothing is left to animate, and the settled render has no reveal spans.
    vi.spyOn(performance, 'now').mockReturnValue(5000)
    started.length = 0
    view2.rerender(<MarkdownText text={'Hello world\n\nNext **bold** done'} streaming reveal={reveal} />)
    expect(started.map(run => run.word)).toEqual(['done'])
    view2.rerender(<MarkdownText text={'Hello world\n\nNext **bold** done'} reveal={reveal} />)
    expect(view2.container.querySelector('[data-reveal]')).toBeNull()
  })
})
