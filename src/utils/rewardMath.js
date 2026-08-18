// Reward accounting for Enjin nomination pools.
//
// On-chain semantics (Enjin relaychain `pallet-nomination-pools`, `do_payout_rewards`):
//   - `RewardPaid.reward` is the GROSS amount added to the pool's reward account from the
//     validator payout, captured BEFORE commission is deducted.
//   - `claim_commission()` then transfers `commission` OUT of the reward account.
//   - Only the remainder (`reward - commission`) is transferred to the bonded account and
//     staked via `bond_extra`, i.e. only the net amount compounds into the pool rate.
//
// Therefore the amount that actually reinvests/compounds is `reward - commission`, NOT
// `reward + commission`. EnjinSight previously added commission (mirroring a bug independently
// found in Enjin's backend indexer), overstating every per-era reward and APY figure by
// `2 * commission` (~1.07/0.93 ≈ +15% at a 7% commission).
// See docs/nomination_pool_reward_accounting_fix.md for the full writeup.

const RATE_PRECISION = 10n ** 18n

/**
 * Net amount reinvested into a pool for a single `RewardPaid` event.
 * This is what compounds into the pool rate: gross reward minus the operator commission.
 */
export function netReinvested(reward, commission) {
  const net = reward - commission
  return net > 0n ? net : 0n
}

/**
 * Pool exchange rate: ENJ per point, scaled by 1e18. `activeStake` is the pool's bonded
 * account active stake (ENJ); `poolSupply` is the total outstanding pool points (sENJ).
 */
export function poolRate(activeStake, poolSupply) {
  if (poolSupply <= 0n) return 0n
  return (activeStake * RATE_PRECISION) / poolSupply
}

/**
 * Per-member reward for an era, derived from the on-chain rate movement.
 *
 * `changeInRate` is `rate_now - rate_prev` (rate scaled by 1e18). A member holding `points`
 * gains `points * changeInRate / 1e18` in value over the era — the member's real value growth.
 * Equals `points * reinvested / totalPoolPoints` once `reinvested` is net of commission, since
 * `reinvested ≈ changeInRate * totalPoolPoints / 1e18`.
 */
export function memberEraReward(points, changeInRate) {
  const reward = (points * changeInRate) / RATE_PRECISION
  return reward > 0n ? reward : 0n
}
