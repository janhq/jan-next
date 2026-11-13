# Web app notes

See the root `AGENTS.md` for architecture, commands and conventions.

React frontend using TypeScript, TanStack Router, Radix UI, and Tailwind CSS. State is managed by React State and Zustand.

## Key Directories

- **`/src/components/ui`** - UI components (buttons, dialogs, inputs)
- **`/src/containers`** - Complex feature components (ChatInput, ThreadContent)  
- **`/src/hooks`** - Custom React hooks (use-chat, useThreads, useAppState)
- **`/src/routes`** - TanStack Router pages
- **`/src/services`** - ServiceHub: API layer for backend communication
- **`/src/lib`** - `dsh-chat-transport.ts` (every chat turn), `llamacpp/` (local engine)
- **`/src/types`** - TypeScript definitions

## Development

### Component Example

```tsx
interface Props {
  title: string
  onAction?: () => void
}

export const MyComponent: React.FC<Props> = ({ title, onAction }) => {
  return (
    <div className="flex items-center gap-2">
      <h2>{title}</h2>
      <Button onClick={onAction}>Action</Button>
    </div>
  )
}
```

### Routing

```tsx
export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings
})
```

### Building & Testing

```bash
make dev        # from the repo root
corepack yarn vitest run --project @janhq/web-app <file>
cd web-app && yarn tsc -b
```

### State Management

```tsx
// Local state
const [value, setValue] = useState<string>('')

// Global state (Zustand)
export const useAppState = create<AppState>((set) => ({
  data: null,
  setData: (data) => set({ data })
}))
```

### Tauri Integration

```tsx
import { useServiceHub } from '@/hooks/useServiceHub'

const serviceHub = useServiceHub()
const threads = await serviceHub.threads().fetchThreads()
```

## Performance Tips

```tsx
// Use React.memo for expensive components
const ExpensiveComponent = React.memo(({ data }) => {
  return <div>{processData(data)}</div>
})

// Debounce frequent updates
const debouncedValue = useDebounce(searchTerm, 300)

// Virtual scrolling for large lists
import { VariableSizeList } from 'react-window'
```

## Debugging

```bash
# React DevTools
# Install browser extension, then:
# - Inspect component tree
# - Debug hooks and state
# - Profile performance

# Check for console errors
# Press F12 → Console tab
```

## Accessibility Guidelines

- Use semantic HTML (`<button>`, `<nav>`, `<main>`)
- Add ARIA labels: `aria-label`, `aria-describedby`
- Ensure keyboard navigation works
- Test with screen readers
- Maintain color contrast ratios

## Best Practices

- Keep components small and focused
- Use TypeScript fully (no `any`)
- Handle loading and error states
- Follow accessibility guidelines
- Extract business logic into hooks

## Dependencies

- **React** - UI framework
- **TypeScript** - Type safety
- **TanStack Router** - Type-safe routing
- **Radix UI** - Accessible components
- **Tailwind CSS** - Utility-first styling
- **Zustand** - State management