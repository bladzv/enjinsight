import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import ToastStack from '../components/ToastStack.jsx'

const ToastContext = createContext(null)

let nextId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef(new Map())

  const dismiss = useCallback((id) => {
    clearTimeout(timersRef.current.get(id))
    timersRef.current.delete(id)
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((message, { type = 'status', duration = 4200, key, detail } = {}) => {
    // A caller-supplied key coalesces repeated pushes into one toast that
    // just extends its own timer, instead of stacking duplicates — the
    // scan-lock toast is pushed from several places in quick succession
    // (every blocked nav click, popstate, the lock-transition effect) and
    // showing one toast per click would spam the stack.
    setToasts(prev => {
      const existing = key ? prev.find(t => t.key === key) : null
      const id = existing?.id ?? nextId++
      clearTimeout(timersRef.current.get(id))
      if (duration) {
        timersRef.current.set(id, setTimeout(() => dismiss(id), duration))
      }
      if (existing) {
        return prev.map(t => (t.id === id ? { ...t, message, type, detail } : t))
      }
      return [...prev, { id, key, message, type, detail }]
    })
  }, [dismiss])

  // Memoized so the context value is referentially stable across renders —
  // without this, every consumer effect that reaches into useToast() (even
  // indirectly, through a plain function that calls toast.push) would need
  // this object in its dependency array, since a fresh {push, dismiss}
  // literal every render is itself an unstable dependency.
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/** @returns {{ push: (message: string, opts?: { type?: 'status'|'error', duration?: number, key?: string }) => void, dismiss: (id: number) => void }} */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast() must be called within a <ToastProvider>.')
  return ctx
}
