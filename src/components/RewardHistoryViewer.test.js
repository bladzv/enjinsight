import { describe, it, expect } from 'vitest'
import { parseRewardImport } from './RewardHistoryViewer.jsx'

describe('parseRewardImport', () => {
  describe('JSON', () => {
    it('parses a records array', () => {
      const text = JSON.stringify({
        _meta: { address: 'en1' },
        records: [{ era: 1170, pool_id: 14, pool_label: 'Pool 14', reward_enj: '1000000000000000000' }],
      })
      const { results, meta } = parseRewardImport(text, 'json')
      expect(meta).toEqual({ address: 'en1' })
      expect(results[0]).toMatchObject({ era: 1170, poolId: 14, poolLabel: 'Pool 14', reward: 1_000_000_000_000_000_000n })
    })

    // The bug this hardening fixes: the previous coercion stripped every
    // non-digit character (including '-' and '.') instead of validating, so
    // '-5' silently became 5n and '1.234' became 1234n.
    it('rejects a negative reward rather than silently flipping its sign', () => {
      const text = JSON.stringify({ records: [{ era: 1, reward_enj: '-5' }] })
      expect(() => parseRewardImport(text, 'json')).toThrow(/reward_enj/)
    })

    it('rejects a decimal reward rather than silently inflating it', () => {
      const text = JSON.stringify({ records: [{ era: 1, reward_enj: '1.234' }] })
      expect(() => parseRewardImport(text, 'json')).toThrow(/reward_enj/)
    })
  })

  describe('CSV', () => {
    const header = 'era,pool_id,pool_label,era_start_block,era_date_utc,member_senj,pool_supply_senj,reinvested_enj,reward_enj,cumulative_enj,apy_pct,rolling_apy_pct'

    it('parses a well-formed row', () => {
      const text = [
        '# enjin_reward_history_export',
        '# address: en1',
        header,
        '1170,14,"Pool 14",100,2026-01-01,0,0,0,1000000000000000000,0,5.5,',
      ].join('\r\n')
      const { results, meta } = parseRewardImport(text, 'csv')
      expect(meta).toEqual({ address: 'en1' })
      expect(results[0]).toMatchObject({ era: 1170, poolId: 14, poolLabel: 'Pool 14', reward: 1_000_000_000_000_000_000n })
    })

    // The bug this hardening fixes: the previous parser stripped every quote
    // and then split on every comma, so a quoted field containing a comma
    // corrupted the rest of the row's column alignment.
    it('does not corrupt the row when a quoted field contains a comma', () => {
      const text = [
        header,
        '1170,14,"Pool 14, Reserve",100,2026-01-01,0,0,0,1000000000000000000,0,5.5,',
      ].join('\r\n')
      const { results } = parseRewardImport(text, 'csv')
      expect(results[0].poolLabel).toBe('Pool 14, Reserve')
      expect(results[0].reward).toBe(1_000_000_000_000_000_000n)
    })

    it('rejects a malformed numeric field with a row-numbered error', () => {
      const text = [
        header,
        '1170,14,"Pool 14",100,2026-01-01,0,0,0,not-a-number,0,5.5,',
      ].join('\r\n')
      expect(() => parseRewardImport(text, 'csv')).toThrow(/CSV row 2/)
    })
  })
})
