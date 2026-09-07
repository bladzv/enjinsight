import { FileDown } from 'lucide-react'
import { formatExportedAtUTC } from '../utils/format.js'

/**
 * The "this came from a file, nothing was fetched" banner, shared by every
 * tool that supports import.
 *
 * Previously four near-identical copies of the same sentence, differing only
 * in the record noun and the trailing verb. The details are laid out as a
 * definition list rather than run together in prose: provenance is key/value
 * data, and a filename, a timestamp and a version are all easier to check
 * against an expectation when they are aligned in a column.
 *
 * Every field renders even when the value is missing — an export written
 * before the shared header carries no `appVersion`, and an em-dash saying so
 * is better than a row that silently disappears.
 *
 * A `<dl>` in a two-column grid, not a `<table>`: this is key/value data, it
 * wraps cleanly on a narrow screen, and it avoids `.data-table-wrap`, whose
 * `overflow-x: auto` would make the panel a scroll container (see `InfoTip`
 * in `PoolRewardTable.jsx` for what that costs).
 *
 * @param {string}   props.note      What did *not* happen — "Nothing was fetched."
 * @param {number}   props.count     Records in the file.
 * @param {string}   props.noun      Singular record noun; pluralised here.
 * @param {string}   [props.typeLabel] Human name of the export schema.
 * @param {object}   [props.filter]  `{exportedRecords, totalRecords}` when the
 *                                   file was written from a filtered view.
 * @param {ReactNode} [props.children] Extra notices, inside the same panel.
 */
export default function ImportProvenance({
  fileName,
  exportedAt,
  appVersion,
  typeLabel = '',
  count,
  noun,
  note,
  filter = null,
  onClear,
  children = null,
}) {
  const plural = count === 1 ? noun : `${noun}s`

  return (
    <div className="space-y-2 rounded-sm border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs text-cyan">
      <div className="flex items-start gap-2">
        <FileDown size={14} className="mt-0.5 flex-shrink-0" />

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-semibold">Showing imported data. {note}</p>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <Row label="File">
              <span className="break-all font-mono">{fileName || '—'}</span>
            </Row>
            <Row label="Exported">
              <span className="font-mono">
                {exportedAt ? formatExportedAtUTC(exportedAt) : '—'}
              </span>
            </Row>
            <Row label="Tool">EnjinSight</Row>
            <Row label="Version">
              <span className="font-mono">{appVersion ? `v${appVersion}` : '—'}</span>
            </Row>
            <Row label="Type">{typeLabel || '—'}</Row>
            <Row label="Records">
              <span className="font-mono">{count.toLocaleString('en')}</span> {plural}
            </Row>

            {/* A filtered export is structurally identical to a full scan, so
                without this the file would silently read as the whole thing.
                `meta.filter` is what makes that recoverable. */}
            {filter && (
              <Row label="Filtered">
                {filter.totalRecords > 0 && (
                  <>
                    <span className="font-mono">{filter.exportedRecords.toLocaleString('en')}</span>
                    {' of '}
                    <span className="font-mono">{filter.totalRecords.toLocaleString('en')}</span>
                    {' records — '}
                  </>
                )}
                exported from a filtered view, not the complete scan.
              </Row>
            )}
          </dl>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="btn-secondary shrink-0 px-3 py-1 text-xs"
        >
          Clear
        </button>
      </div>

      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <>
      <dt className="text-cyan/70">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}
