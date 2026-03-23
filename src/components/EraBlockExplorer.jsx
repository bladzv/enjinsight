/**
 * EraBlockExplorer — renders the standalone era-explorer.html tool in a full-height
 * iframe. The static page is served from /era-explorer.html (public/).
 */
export default function EraBlockExplorer() {
  return (
    <div
      className="w-full"
      style={{ height: 'calc(100dvh - 56px)' }}
    >
      <iframe
        src="/era-explorer.html"
        title="Era Block Explorer"
        style={{ display: 'block', width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  )
}
