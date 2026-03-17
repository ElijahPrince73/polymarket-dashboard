// City-specific confidence thresholds based on historical performance
// Worse performing cities get tighter entry criteria

export const CITY_THRESHOLDS = {
  // TIER 1: Proven performers - standard thresholds
  "Miami": { minEdge: 0.15, minModelDiff: 0.08, maxPrice: 0.85 },
  "Paris": { minEdge: 0.15, minModelDiff: 0.08, maxPrice: 0.85 },
  "London": { minEdge: 0.15, minModelDiff: 0.08, maxPrice: 0.85 },
  "Chicago": { minEdge: 0.15, minModelDiff: 0.08, maxPrice: 0.85 },
  "Dallas": { minEdge: 0.15, minModelDiff: 0.08, maxPrice: 0.85 },

  // TIER 2: Marginal performers - slightly tighter
  "Atlanta": { minEdge: 0.18, minModelDiff: 0.10, maxPrice: 0.80 },
  "NYC": { minEdge: 0.18, minModelDiff: 0.10, maxPrice: 0.80 },
  "Sao Paulo": { minEdge: 0.18, minModelDiff: 0.10, maxPrice: 0.80 },

  // TIER 3: Poor performers - much tighter criteria
  "Seoul": { minEdge: 0.25, minModelDiff: 0.15, maxPrice: 0.75 },
  "Wellington": { minEdge: 0.25, minModelDiff: 0.15, maxPrice: 0.75 },
  "Seattle": { minEdge: 0.25, minModelDiff: 0.15, maxPrice: 0.75 },

  // TIER 4: Terrible performers - very tight (only slam dunks)
  "Toronto": { minEdge: 0.30, minModelDiff: 0.20, maxPrice: 0.70 },
  "Tokyo": { minEdge: 0.30, minModelDiff: 0.20, maxPrice: 0.70 },
  "Singapore": { minEdge: 0.30, minModelDiff: 0.20, maxPrice: 0.70 },
};

// Fallback for cities not in the map (use standard thresholds)
export const DEFAULT_THRESHOLDS = {
  minEdge: 0.15,
  minModelDiff: 0.08,
  maxPrice: 0.85
};

export function getCityThresholds(cityName) {
  return CITY_THRESHOLDS[cityName] || DEFAULT_THRESHOLDS;
}

// Additional filters based on performance analysis
export const CITY_FILTERS = {
  // Cities with poor directional accuracy - require higher model consensus
  "Toronto": { requireMinModels: 4 }, // Only enter if 4+ models agree
  "Tokyo": { requireMinModels: 4 },
  "Seattle": { requireMinModels: 4 },
  
  // Cities with poor risk/reward - reduce position sizing
  "Seoul": { sizingMultiplier: 0.7 }, // 30% smaller positions
  "Wellington": { sizingMultiplier: 0.7 },
  "NYC": { sizingMultiplier: 0.8 }, // 20% smaller positions

  // Cities with model issues - require price discrepancy
  "Singapore": { requirePriceDiscrepancy: 0.12 }, // Market must be 12%+ off model
  "Toronto": { requirePriceDiscrepancy: 0.15 }, // 15%+ discrepancy required
};

export function getCityFilters(cityName) {
  return CITY_FILTERS[cityName] || {};
}