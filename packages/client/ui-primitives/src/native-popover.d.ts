/** Native contextual guidance attributes not yet represented by React 18. */
import 'react'

declare module 'react' {
  interface HTMLAttributes<T> {
    popover?: 'hint' | 'manual'
  }

  interface ButtonHTMLAttributes<T> {
    interestfor?: string
    popovertarget?: string
    popovertargetaction?: 'show'
  }
}
