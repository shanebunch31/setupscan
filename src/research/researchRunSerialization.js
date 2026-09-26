const SPECIAL_NUMBER_KEY = '__setupscan_research_number_v1__'
const SPECIAL_NUMBERS = new Set(['Infinity', '-Infinity', 'NaN'])

export function stringifyResearchJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) {
      return { [SPECIAL_NUMBER_KEY]: String(item) }
    }
    return item
  })
}

export function parseResearchJson(value) {
  const revive = (_key, item) => {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      Object.keys(item).length === 1 &&
      SPECIAL_NUMBERS.has(item[SPECIAL_NUMBER_KEY])
    ) {
      return Number(item[SPECIAL_NUMBER_KEY])
    }
    return item
  }
  if (typeof value === 'string') return JSON.parse(value, revive)
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value), revive)
}