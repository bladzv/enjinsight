import { Component, Fragment } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * Per-view error boundary. Without this, a render throw anywhere inside a tool
 * (a 400-1950 line component with a live WebSocket scan behind it) white-screened
 * the entire app rather than just that view.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, resetKey: 0 }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-sm border border-white/[0.06] bg-surface px-6 py-10 text-center shadow-ambient">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" aria-hidden="true" />
          <p className="text-sm text-danger mb-3">
            {this.props.label ? `${this.props.label} hit an unexpected error.` : 'This view hit an unexpected error.'}
          </p>
          <p className="text-xs text-text-secondary mb-4">
            {this.state.error?.message || 'Something went wrong while rendering.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState(s => ({ error: null, resetKey: s.resetKey + 1 }))}
            className="btn-primary"
          >
            Try Again
          </button>
        </div>
      )
    }
    // Keying on resetKey forces a fresh mount of the subtree on retry, rather
    // than re-rendering the same instance that just threw with whatever state
    // put it there.
    // Fragment (not a span/div) avoids introducing an inline or block wrapper
    // around children that expect to sit directly in a flex/grid parent.
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>
  }
}
