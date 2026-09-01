/**
 * Whether rail navigation, back, and the staking mode switch should be
 * refused because a scan is running somewhere in the app.
 *
 * Pulled out of App.jsx as a pure function so the condition that gates five
 * separate call sites (popstate, handleNavigate, handleBack, handleModeChange,
 * the rail's dimmed state) can be tested once instead of only by exercising
 * the UI. `isLoading` covers the staking tool, which lives directly in
 * App.jsx; the other three tools report their own loading state up via
 * onScanStateChange since they are lazy-loaded, separately-owned views.
 */
export function isNavigationLocked({
  isLoading,
  balanceScanActive,
  rewardScanActive,
  infusionScanActive,
}) {
  return Boolean(isLoading || balanceScanActive || rewardScanActive || infusionScanActive)
}
