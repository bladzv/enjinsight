import { useEffect, useRef } from 'react'

export default function PointerAura() {
  const auraRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const aura = auraRef.current
    const finePointer = window.matchMedia('(pointer: fine)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    if (!aura || !finePointer.matches || reducedMotion.matches) return

    let frameId = 0
    let targetX = window.innerWidth * 0.5
    let targetY = window.innerHeight * 0.3
    let currentX = targetX
    let currentY = targetY

    function render() {
      currentX += (targetX - currentX) * 0.14
      currentY += (targetY - currentY) * 0.14
      aura.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`
      frameId = window.requestAnimationFrame(render)
    }

    function show() {
      aura.style.opacity = '1'
    }

    function hide() {
      aura.style.opacity = '0'
    }

    function handlePointerMove(event) {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
      targetX = event.clientX
      targetY = event.clientY
      show()
    }

    function handleResize() {
      targetX = Math.min(targetX, window.innerWidth)
      targetY = Math.min(targetY, window.innerHeight)
    }

    render()

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerdown', handlePointerMove, { passive: true })
    window.addEventListener('pointercancel', hide)
    window.addEventListener('blur', hide)
    window.addEventListener('resize', handleResize)
    document.documentElement.addEventListener('pointerleave', hide)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerMove)
      window.removeEventListener('pointercancel', hide)
      window.removeEventListener('blur', hide)
      window.removeEventListener('resize', handleResize)
      document.documentElement.removeEventListener('pointerleave', hide)
    }
  }, [])

  return <div ref={auraRef} className="pointer-aura" aria-hidden="true" />
}
