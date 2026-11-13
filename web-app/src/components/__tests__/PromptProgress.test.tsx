import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PromptProgress } from '../PromptProgress'
import { useAppState } from '@/hooks/useAppState'

// Mock the useAppState hook
vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => undefined,
}))

const mockUseAppState = useAppState as ReturnType<typeof vi.fn>

describe('PromptProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show load percentage while loading model', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        loadingModel: true,
        modelLoadProgress: { modelId: 'model-1', value: 0.42 },
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading model: 42%')).toBeInTheDocument()
  })

  it('should not render a progress bar while loading a model', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        loadingModel: true,
        modelLoadProgress: { modelId: 'model-1', value: 0.42 },
      })
    )

    const { container } = render(<PromptProgress />)

    expect(screen.getByText('Loading model: 42%')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="progress"]')).toBeNull()
  })

  it('should name the stage when a load has more than one (vision model)', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        loadingModel: true,
        modelLoadProgress: {
          modelId: 'model-1',
          value: 0.8,
          stage: 'mmproj_model',
          stages: ['text_model', 'mmproj_model'],
        },
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading encoder: 80%')).toBeInTheDocument()
  })

  it('should not name the stage for a plain single-stage text-only load', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        loadingModel: true,
        modelLoadProgress: {
          modelId: 'model-1',
          value: 0.5,
          stage: 'text_model',
          stages: ['text_model'],
        },
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading model: 50%')).toBeInTheDocument()
  })

  it('should fall back to generic loading label when no progress event has arrived yet', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        loadingModel: true,
        modelLoadProgress: undefined,
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading model…')).toBeInTheDocument()
  })

  it('should show Working… when not loading', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({ loadingModel: false, loadingModels: {}, modelLoadProgressByThread: {} })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Working…')).toBeInTheDocument()
  })

  it('should render nothing with hideIdle when not loading', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({ loadingModel: false, loadingModels: {}, modelLoadProgressByThread: {} })
    )

    const { container } = render(<PromptProgress hideIdle />)

    expect(container.firstChild).toBeNull()
  })
})
