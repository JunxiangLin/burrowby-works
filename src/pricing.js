// Single price table for the estimated cost readout. US dollars per million
// tokens. These are PLACEHOLDER list prices: check them against current
// pricing and edit here; nothing else in the app holds a price.
// The first entry whose `match` appears in the model id wins.
const PRICES = [
  { match: 'haiku', inPerM: 1, outPerM: 5 },
  { match: 'sonnet', inPerM: 3, outPerM: 15 },
  { match: 'opus', inPerM: 15, outPerM: 75 },
];

// Estimated cost in USD, or null when the model is unknown or no tokens were recorded.
function estimateCost(model, inTok, outTok) {
  const p = PRICES.find((x) => String(model || '').toLowerCase().includes(x.match));
  if (!p || !(inTok > 0 || outTok > 0)) return null;
  return ((inTok || 0) * p.inPerM + (outTok || 0) * p.outPerM) / 1e6;
}

module.exports = { PRICES, estimateCost };
