// Display the already-awarded rule points; do not rescore market data.
// RSI and relative volume can earn partial credit (8 of 15) in the scanner.
export function confirmationPassed(reason) {
  if (reason.label === 'RSI momentum' || reason.label === 'Relative volume') {
    return reason.points >= 15
  }
  return reason.points > 0
}

export function groupScannerEvidence(reasons = []) {
  return {
    passed: reasons.filter(confirmationPassed),
    missing: reasons.filter((reason) => !confirmationPassed(reason)),
  }
}
