/**
 * 轻量模糊匹配：先找连续子串，再退化为按顺序逐字匹配。
 *
 * 项目下拉使用它同时匹配项目名和路径。中文没有分词，按字匹配足够；
 * 英文/路径不区分大小写。返回 -1 表示不匹配，分数越大越靠前。
 */
export function fuzzyScore(text, query) {
  const haystack = String(text || '').toLowerCase()
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return 1
  if (!haystack) return -1

  const direct = haystack.indexOf(needle)
  if (direct !== -1) return 1000 - direct

  let index = 0
  let first = -1
  let score = 0
  let streak = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, index)
    if (found === -1) return -1
    if (first === -1) first = found
    streak = found === index ? streak + 1 : 0
    score += streak * 2
    index = found + 1
  }
  // 越早出现越相关；连续命中的字符额外加分。
  return 100 - first + score
}

/**
 * 多字段、多关键词匹配。查询按空白拆词，每个词至少命中一个字段；
 * 返回总分，任一关键词不命中则返回 -1。
 */
export function fuzzyFieldsScore(fields, query) {
  const tokens = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return 1

  let total = 0
  for (const token of tokens) {
    let best = -1
    for (const field of fields) {
      best = Math.max(best, fuzzyScore(field, token))
    }
    if (best < 0) return -1
    total += best
  }
  return total
}
