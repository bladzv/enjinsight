/**
 * ScanImportPanel — import for one or more scan schemas.
 *
 * JSON only, and every file is validated against the `enjinsight` tool marker
 * and the accepted schemas before its data is trusted — see scanExport.js for
 * why that check exists and what it catches. The drop zone, size/extension
 * checks and decrypt flow all live in ImportDropPanel.
 *
 * Accepting a *list* of schemas is what lets Staking Cadence have a single
 * import pane: the envelope already says whether a file is a validator or a
 * pool scan, so the panel reads it and hands the caller the schema alongside
 * the parsed result. Asking the user to pick the mode first, then refusing the
 * file when it disagreed, was friction with nothing behind it.
 */
import { useCallback } from 'react'
import { MAX_SCAN_IMPORT_MB } from '../constants.js'
import { SCHEMA_LABELS, peekEnvelope, decryptScanFile } from '../utils/scanExport.js'
import ImportDropPanel from './ImportDropPanel.jsx'

/** "Staking Cadence (validator mode) or Staking Cadence (pool mode)" */
function acceptedLabel(accept) {
  const names = accept.map(a => SCHEMA_LABELS[a.schema] ?? a.schema)
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/**
 * @param {object} props
 * @param {{schema: string, importFn: (text: string) => object}[]} props.accept
 *   The schemas this panel takes, each with the parser for it.
 * @param {(parsed: object, fileName: string, schema: string) => void} props.onImport
 *   Receives the schema so a caller accepting several can route on it.
 * @param {string} [props.heading] - defaults to naming the accepted schemas.
 * @param {boolean} [props.allowEncryption] - accept and prompt for .enc.json files.
 * @param {boolean} [props.disabled]
 */
export default function ScanImportPanel({
  accept,
  onImport,
  heading,
  allowEncryption = false,
  disabled = false,
}) {
  const schemas = accept.map(a => a.schema)

  /**
   * Read the envelope header before committing to a full parse — or to a
   * password prompt, for an encrypted file. Naming the owning tool here means
   * a wrong-tool file is refused up front rather than after the user has
   * typed a password for it.
   */
  const inspect = useCallback((text) => {
    let peek
    try {
      peek = peekEnvelope(text)
    } catch (e) {
      return { ok: false, reason: e.message }
    }
    if (peek.schema && !schemas.includes(peek.schema)) {
      return {
        ok: false,
        reason: `This is a ${SCHEMA_LABELS[peek.schema] ?? peek.schema} export. `
          + `Import it from that tool, not ${acceptedLabel(accept)}.`,
      }
    }
    return { ok: true, encrypted: peek.encrypted }
  }, [accept, schemas])

  /**
   * Parse with the entry matching the file's own schema.
   *
   * Re-reads the header rather than carrying it over from `inspect`: the two
   * are separate callbacks, and a second parse of a few header fields is
   * cheaper than threading state between them.
   */
  const applyText = useCallback((text, fileName) => {
    const schema = peekEnvelope(text).schema
    const entry = accept.find(a => a.schema === schema) ?? accept[0]
    // importFn throws ScanImportError on a bad file; ImportDropPanel catches
    // it and shows the message against the file.
    onImport(entry.importFn(text), fileName, entry.schema)
  }, [accept, onImport])

  const onFile = useCallback((text, ext, fileName) => {
    applyText(text, fileName)
  }, [applyText])

  const onDecrypt = useCallback(async (text, password, ext, fileName) => {
    applyText(await decryptScanFile(text, password), fileName)
  }, [applyText])

  return (
    <ImportDropPanel
      heading={heading ?? `Load ${acceptedLabel(accept)} scan`}
      extensions={['json']}
      maxMb={MAX_SCAN_IMPORT_MB}
      hint={`JSON only — max ${MAX_SCAN_IMPORT_MB} MB`}
      sourceLabel={acceptedLabel(accept)}
      inspect={inspect}
      onFile={onFile}
      onDecrypt={allowEncryption ? onDecrypt : undefined}
      disabled={disabled}
      passwordFieldId="scan-dec-pwd"
    />
  )
}
