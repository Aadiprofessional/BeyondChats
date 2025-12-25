export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export async function fetchArticles({ page = 1, perPage = 50 } = {}) {
  const res = await fetch(`${API_BASE_URL}/api/articles?page=${page}&per_page=${perPage}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export function normalizeBaseUrl(u) {
  try {
    const x = new URL(u)
    x.searchParams.delete('updated')
    x.hash = ''
    return x.origin + x.pathname
  } catch {
    return u.split('?')[0].split('#')[0]
  }
}

export function groupByBaseUrl(items) {
  const groups = new Map()
  for (const it of items) {
    const key = normalizeBaseUrl(it.url || '')
    const arr = groups.get(key) || []
    arr.push(it)
    groups.set(key, arr)
  }
  return Array.from(groups.entries()).map(([base, list]) => ({ base, list }))
}
