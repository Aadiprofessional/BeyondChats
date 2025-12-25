import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, fetchArticles, groupByBaseUrl } from './api.js'

function extractReferencesBlock(text) {
  const s = String(text || '')
  const idx = s.lastIndexOf('References:')
  if (idx === -1) return { body: s, refs: [] }
  const body = s.slice(0, idx).trim()
  const refsText = s.slice(idx)
  const lines = refsText.split('\n').map(l => l.trim()).filter(Boolean)
  const urls = []
  for (const l of lines) {
    const m = l.match(/https?:\/\/[^\s\)\"']+/)
    if (m) urls.push(m[0])
  }
  return { body, refs: Array.from(new Set(urls)).slice(0, 2) }
}

function ArticleCard({ article }) {
  const [expanded, setExpanded] = useState(false)
  const isUpdated = (article.source || '').toLowerCase().includes('updated')
  const label = isUpdated ? 'Updated' : 'Original'
  const { body, refs } = useMemo(() => extractReferencesBlock(article.content || ''), [article.content])
  let host = ''
  try {
    host = new URL(article.url).hostname
  } catch {}
  return (
    <div className="card">
      <div className="card-header">
        <span className={`badge ${isUpdated ? 'badge-updated' : 'badge-original'}`}>{label}</span>
        <h3 className="title">{article.title}</h3>
        {host && <span className="pill">{host}</span>}
      </div>
      <div className="meta">
        {(article.author || article.source) && (
          <div className="row">
            {article.author ? <span>By {article.author}</span> : null}
            <span className="spacer">•</span>
            <span>{article.source}</span>
          </div>
        )}
        {article.published_at && (
          <div className="row">
            <span>{new Date(article.published_at).toLocaleDateString()}</span>
          </div>
        )}
      </div>
      {article.image_url && (
        <img className="cover" src={article.image_url} alt={article.title} />
      )}
      <div className="content">
        <p className="excerpt">{article.excerpt}</p>
        {expanded ? (
          <div className="content-full">{body}</div>
        ) : (
          <div className="content-truncated">{body.slice(0, 350)}{body.length > 350 ? '…' : ''}</div>
        )}
        {isUpdated && refs.length > 0 && (
          <div className="refs">
            <div className="refs-title">References</div>
            <ul className="refs-list">
              {refs.map((u, i) => (
                <li key={i}><a href={u} target="_blank" rel="noreferrer">{u}</a></li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="actions">
        <a className="link" href={article.url} target="_blank" rel="noreferrer">Open Article</a>
        <button className="btn" onClick={() => setExpanded(e => !e)}>{expanded ? 'Show Less' : 'Show More'}</button>
      </div>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const perPage = 50
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetchArticles({ page, perPage })
        setData(res)
      } catch (e) {
        setError(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [page])

  const items = useMemo(() => (data?.data ?? []), [data])
  const groups = useMemo(() => groupByBaseUrl(items), [items])
  const filteredGroups = useMemo(() => {
    return groups.map(g => ({
      base: g.base,
      list: g.list.filter(a => {
        const isUpd = (a.source || '').toLowerCase().includes('updated')
        if (filter === 'original') return !isUpd
        if (filter === 'updated') return isUpd
        return true
      })
    })).filter(g => g.list.length > 0)
  }, [groups, filter])

  return (
    <div className="container">
      <header className="header">
        <div className="brand">
          <img className="logo" src={`${API_BASE_URL}/beyond_chats_logo.jpeg`} alt="BeyondChats" />
          <h1>BeyondChats Articles</h1>
        </div>
        <div className="controls">
          <div className="pager">
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
            <span>Page {page}</span>
            <button disabled={!data?.next_page_url} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
          <div className="filterbar">
            <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
            <button className={`chip ${filter === 'original' ? 'active' : ''}`} onClick={() => setFilter('original')}>Original</button>
            <button className={`chip ${filter === 'updated' ? 'active' : ''}`} onClick={() => setFilter('updated')}>Updated</button>
          </div>
        </div>
      </header>

      <div className="notice">
        <strong>Note:</strong> Updated versions are published as new records. The UI groups originals and their updates by base URL to avoid confusion.
      </div>

      {loading && <div className="status">Loading…</div>}
      {error && <div className="status error">Error: {error}</div>}

      <main className="groups">
        {filteredGroups.map(g => (
          <section key={g.base} className="group">
            <h2 className="group-title">{g.list[0]?.title || g.base}</h2>
            <div className="grid">
              {g.list
                .sort((a, b) => (a.source || '').localeCompare(b.source || ''))
                .map(a => <ArticleCard key={a.id} article={a} />)}
            </div>
          </section>
        ))}
        {!loading && filteredGroups.length === 0 && (
          <div className="status">No articles found</div>
        )}
      </main>
    </div>
  )
}
