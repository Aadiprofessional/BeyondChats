import axios from 'axios'
import dotenv from 'dotenv'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import pLimit from 'p-limit'
import OpenAI from 'openai'

dotenv.config()

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8000'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'
const PER_PAGE = Number(process.env.PER_PAGE || 50)
const MIN_CONTENT = Number(process.env.MIN_CONTENT || 800)
let lastSearxAnalysis = null
const LLM_PROVIDER = GROQ_API_KEY ? 'groq' : (OPENAI_API_KEY ? 'openai' : 'simple')

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null

const http = axios.create({
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
  }
})

async function fetchLatestArticle() {
  const res = await http.get(`${API_BASE_URL}/api/articles?per_page=1`)
  const data = res.data
  const item = data.data?.[0]
  if (!item) throw new Error('No articles found')
  return item
}

async function fetchAllArticles() {
  let page = 1
  const acc = []
  while (true) {
    const res = await http.get(`${API_BASE_URL}/api/articles?page=${page}&per_page=${PER_PAGE}`)
    const data = res.data
    const items = Array.isArray(data?.data) ? data.data : []
    acc.push(...items)
    if (!data?.next_page_url) break
    page++
    if (page > 10) break
  }
  return acc
}

function isArticleUrl(u) {
  try {
    const x = new URL(u)
    if (x.hostname.includes('beyondchats.com')) return false
    if (x.hostname.includes('searxng.matrixaiserver.com')) return false
    if (x.hostname.includes('w3.org')) return false
    if (x.hostname.includes('web.archive.org')) return false
    if (x.hostname.includes('youtube.com') || x.hostname.includes('youtu.be')) return false
    if (x.hostname.includes('twitter.com') || x.hostname.includes('x.com')) return false
    if (x.hostname.includes('facebook.com') || x.hostname.includes('instagram.com') || x.hostname.includes('reddit.com') || x.hostname.includes('linkedin.com')) return false
    if (x.hostname.includes('amazon.')) return false
    if (x.hostname.includes('github.com')) return false
    if (x.hostname.includes('google.') || x.hostname.includes('webcache.googleusercontent.com')) return false
    if (!/^https?:\/\//.test(u)) return false
    const path = x.pathname.toLowerCase()
    const depth = path.split('/').filter(Boolean).length
    if (depth < 2) return false
    return true
  } catch {
    return false
  }
}

function filterWithReasons(urls) {
  const accepted = []
  const rejected = []
  for (const u of urls) {
    let ok = isArticleUrl(u)
    if (!ok) {
      rejected.push({ url: u, reason: 'not_article_or_excluded_domain' })
      continue
    }
    try {
      const host = new URL(u).hostname
      if (accepted.find(a => new URL(a).hostname === host)) {
        rejected.push({ url: u, reason: 'duplicate_domain' })
        continue
      }
    } catch {
      rejected.push({ url: u, reason: 'invalid_url' })
      continue
    }
    accepted.push(u)
  }
  return { accepted, rejected }
}

function parseUrlsFromText(text) {
  const re = /(https?:\/\/[^\s\)\"\']+)/g
  const urls = []
  let m
  while ((m = re.exec(text)) !== null) {
    urls.push(m[1])
  }
  return Array.from(new Set(urls)).filter(isArticleUrl)
}

function validateSearxResponse(query, mode, data) {
  const issues = []
  let valid = []
  if (mode === 'text') {
    const s = typeof data === 'string' ? data : JSON.stringify(data)
    if (s.toLowerCase().includes('<html')) {
      issues.push('text_format_returned_html')
      try {
        const dom = new JSDOM(s)
        const doc = dom.window.document
        const anchors = Array.from(doc.querySelectorAll('a'))
        valid = anchors.map(a => a.getAttribute('href') || '').filter(isArticleUrl)
      } catch {
        valid = parseUrlsFromText(s)
      }
    } else {
      valid = parseUrlsFromText(s)
    }
  } else if (mode === 'json') {
    const items = Array.isArray(data?.results) ? data.results : []
    if (!items.length) issues.push('json_results_empty')
    valid = items.map(r => r?.url).filter(Boolean).filter(isArticleUrl)
  } else if (mode === 'html') {
    try {
      const dom = new JSDOM(typeof data === 'string' ? data : '')
      const doc = dom.window.document
      const anchors = Array.from(doc.querySelectorAll('a'))
      valid = anchors.map(a => a.getAttribute('href') || '').filter(isArticleUrl)
    } catch {
      valid = []
    }
  }
  const dedup = Array.from(new Set(valid)).filter(isArticleUrl)
  if (dedup.length < 2) issues.push('insufficient_valid_article_urls')
  const analysis = { query, mode, issues, valid_urls: dedup }
  lastSearxAnalysis = analysis
  return analysis
}

async function searxSearch(query) {
  const url = 'https://searxng.matrixaiserver.com/search'
  try {
    const resGetJson = await http.get(url, { params: { q: query, format: 'json' }, headers: { Accept: 'application/json' } })
    const a1 = validateSearxResponse(query, 'json', resGetJson.data)
    if (a1.valid_urls.length >= 2) return a1.valid_urls.slice(0, 10)
  } catch {}
  try {
    const bodyText = new URLSearchParams()
    bodyText.set('q', query)
    bodyText.set('format', 'text')
    const resPostText = await http.post(url, bodyText.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    const a2 = validateSearxResponse(query, 'text', resPostText.data)
    if (a2.valid_urls.length >= 2) return a2.valid_urls.slice(0, 10)
  } catch {}
  try {
    const bodyJson = new URLSearchParams()
    bodyJson.set('q', query)
    bodyJson.set('format', 'json')
    const resPostJson = await http.post(url, bodyJson.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    const a3 = validateSearxResponse(query, 'json', resPostJson.data)
    if (a3.valid_urls.length >= 2) return a3.valid_urls.slice(0, 10)
  } catch {}
  try {
    const resGetHtml = await http.get(url, { params: { q: query }, headers: { Accept: 'text/html' } })
    const a4 = validateSearxResponse(query, 'html', resGetHtml.data)
    return a4.valid_urls.slice(0, 10)
  } catch {
    return []
  }
}

function parseGoogleLinks(html) {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const anchors = Array.from(doc.querySelectorAll('a'))
  const urls = []
  for (const a of anchors) {
    const href = a.getAttribute('href') || ''
    if (/^\/url\?q=/.test(href)) {
      const u = new URL('https://www.google.com' + href)
      const q = u.searchParams.get('q')
      if (!q) continue
      try {
        const target = new URL(q)
        const host = target.hostname
        if (host.includes('google.') || host.includes('webcache.googleusercontent.com')) continue
        if (host.includes('beyondchats.com')) continue
        urls.push(target.toString())
      } catch {}
    }
    if (/^https?:\/\//.test(href)) {
      try {
        const target = new URL(href)
        const host = target.hostname
        if (host.includes('google.') || host.includes('webcache.googleusercontent.com')) continue
        if (host.includes('beyondchats.com')) continue
        urls.push(target.toString())
      } catch {}
    }
  }
  const dedup = Array.from(new Set(urls))
  const filtered = dedup.filter(u => {
    try {
      const target = new URL(u)
      const path = target.pathname.toLowerCase()
      return path.includes('/blog') || path.includes('/news') || path.split('/').filter(Boolean).length >= 2
    } catch {
      return false
    }
  })
  return filtered.slice(0, 5)
}

async function googleSearch(query) {
  const q = `${query} -site:beyondchats.com`
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20&hl=en&pws=0`
  const res = await http.get(url)
  return parseGoogleLinks(res.data)
}

function parseDuckLinks(html) {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const anchors = Array.from(doc.querySelectorAll('a'))
  const urls = []
  for (const a of anchors) {
    const cls = a.getAttribute('class') || ''
    const href = a.getAttribute('href') || ''
    if (cls.includes('result__a') && /^https?:\/\//.test(href)) {
      try {
        const target = new URL(href)
        if (target.hostname.includes('beyondchats.com')) continue
        urls.push(target.toString())
      } catch {}
    }
  }
  return Array.from(new Set(urls))
}

async function duckSearch(query) {
  const q = `${query} -site:beyondchats.com`
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  const res = await http.get(url)
  return parseDuckLinks(res.data)
}

function parseBingLinks(html) {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const anchors = Array.from(doc.querySelectorAll('li.b_algo h2 a, h2 a'))
  const urls = []
  for (const a of anchors) {
    const href = a.getAttribute('href') || ''
    if (!/^https?:\/\//.test(href)) continue
    try {
      const target = new URL(href)
      if (target.hostname.includes('beyondchats.com')) continue
      urls.push(target.toString())
    } catch {}
  }
  return Array.from(new Set(urls))
}

async function bingSearch(query) {
  const q = `${query} -site:beyondchats.com`
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20`
  const res = await http.get(url)
  return parseBingLinks(res.data)
}

function extractMainContent(html, baseUrl) {
  try {
    const dom = new JSDOM(html, { url: baseUrl })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (!article) throw new Error('no_article')
    const text = article.textContent?.trim() || ''
    const title = article.title || ''
    if (!text || text.length < 300) throw new Error('too_short')
    return { title, text }
  } catch {
    try {
      const dom = new JSDOM(html, { url: baseUrl })
      const doc = dom.window.document
      let target = doc.querySelector('article')
      if (!target) target = doc.querySelector('main')
      if (!target) target = doc.querySelector('#content')
      if (!target) target = doc.body
      const ps = Array.from(target.querySelectorAll('p')).map(p => p.textContent?.trim() || '').filter(Boolean)
      const text = ps.join('\n')
      const title = doc.title || ''
      if (!text || text.length < 300) return null
      return { title, text }
    } catch {
      return null
    }
  }
}

function sanitizeHtml(html) {
  let s = String(html || '')
  s = s.replace(/border-width\s*:\s*unset/gi, '')
  s = s.replace(/border\s*:\s*unset/gi, '')
  s = s.replace(/outline\s*:\s*unset/gi, '')
  s = s.replace(/:\s*unset/gi, ': initial')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi, '')
  s = s.replace(/\sstyle="[^"]*"/gi, '')
  return s
}

async function fetchAndExtract(url) {
  const res = await http.get(url)
  const safeHtml = sanitizeHtml(res.data)
  let content = extractMainContent(safeHtml, url)
  if (!content || !content.text || content.text.length < 300) {
    try {
      const dom = new JSDOM(safeHtml, { url })
      const doc = dom.window.document
      let target = doc.querySelector('article')
      if (!target) target = doc.querySelector('main')
      if (!target) target = doc.querySelector('#content')
      if (!target) target = doc.body
      const ps = Array.from(target.querySelectorAll('p')).map(p => p.textContent?.trim() || '').filter(Boolean)
      const text = ps.join('\n')
      content = { title: doc.title || '', text }
    } catch {
      const plain = String(safeHtml).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      const paragraphs = plain.split(/<\/?p[^>]*>/i).map(s => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
      const text = paragraphs.join('\n')
      content = { title: '', text }
    }
  }
  return { url, content }
}

async function rewriteWithLLM(original, references) {
  if (GROQ_API_KEY) {
    const system = 'Rewrite the article to match tone, formatting, and structure of references. Preserve accuracy and intent. Use clear headings and web-friendly sections.'
    const user = JSON.stringify({
      original_title: original.title,
      original_content: original.content || original.excerpt || '',
      reference_1: references[0]?.content?.text || '',
      reference_2: references[1]?.content?.text || ''
    })
    const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7
    }, {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` }
    })
    const out = resp.data?.choices?.[0]?.message?.content || ''
    if (out) return out
  }
  if (!client) {
    return await simpleRewrite(original, references)
  }
  const system = 'You rewrite the provided article to match the tone, formatting, and structure of the reference articles. Preserve factual accuracy and intent. Improve headings, flow, and readability. Keep it suitable for web publishing with clear sections.'
  const user = JSON.stringify({
    original_title: original.title,
    original_content: original.content || original.excerpt || '',
    reference_1: references[0]?.content?.text || '',
    reference_2: references[1]?.content?.text || ''
  })
  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.7
  })
  const text = response.choices?.[0]?.message?.content || ''
  return text
}

async function updateArticle(id, payload) {
  const res = await http.patch(`${API_BASE_URL}/api/articles/${id}`, payload, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
  })
  return res.data
}

async function createArticle(payload) {
  const res = await http.post(`${API_BASE_URL}/api/articles`, payload, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
  })
  return res.data
}

async function fetchArticleById(id) {
  const res = await http.get(`${API_BASE_URL}/api/articles/${id}`)
  return res.data
}

function normalizeBaseUrl(u) {
  try {
    const x = new URL(u)
    x.searchParams.delete('updated')
    x.hash = ''
    return x.origin + x.pathname
  } catch {
    return u.split('?')[0].split('#')[0]
  }
}

function alreadyHasUpdated(all, original) {
  const base = normalizeBaseUrl(original.url || '')
  for (const it of all) {
    if ((it.source || '').toLowerCase().includes('updated')) {
      const b2 = normalizeBaseUrl(it.url || '')
      if (b2 === base) return true
    }
  }
  return false
}

function latestUpdatedForBase(all, base) {
  const candidates = all.filter(it => (it.source || '').toLowerCase().includes('updated') && normalizeBaseUrl(it.url || '') === base)
  if (!candidates.length) return null
  const sorted = candidates.sort((a, b) => (b.id || 0) - (a.id || 0))
  return sorted[0]
}

async function deleteArticle(id) {
  const res = await http.delete(`${API_BASE_URL}/api/articles/${id}`, {
    headers: { Accept: 'application/json' }
  })
  return res.data
}

async function cleanupUpdatedDuplicates(all) {
  const map = new Map()
  for (const it of all) {
    const base = normalizeBaseUrl(it.url || '')
    const arr = map.get(base) || []
    arr.push(it)
    map.set(base, arr)
  }
  const deleted = []
  for (const [base, list] of map.entries()) {
    const updated = list.filter(it => (it.source || '').toLowerCase().includes('updated'))
    if (updated.length > 1) {
      const sorted = updated.sort((a, b) => (b.id || 0) - (a.id || 0))
      const keep = sorted[0]
      const remove = sorted.slice(1)
      for (const r of remove) {
        try {
          await deleteArticle(r.id)
          deleted.push(r.id)
        } catch {}
      }
    }
  }
  return deleted
}

function fiveOldestOriginals(all) {
  const originals = all.filter(a => (a.source || '').toLowerCase() === 'beyondchats')
  const withDate = originals.map(a => ({ ...a, _ts: a.published_at ? new Date(a.published_at).getTime() : 0 }))
  const sorted = withDate.sort((a, b) => (a._ts - b._ts) || ((a.id || 0) - (b.id || 0)))
  return sorted.slice(0, 5)
}

async function findReferences(query) {
  let candidates = await googleSearch(`${query} -site:beyondchats.com`)
  let f = filterWithReasons(candidates)
  if (f.accepted.length < 2) {
    const b = await bingSearch(`${query} -site:beyondchats.com`)
    candidates = [...candidates, ...b]
    f = filterWithReasons(candidates)
  }
  if (f.accepted.length < 2) {
    const s = await searxSearch(`${query} -site:beyondchats.com`)
    candidates = [...candidates, ...s]
    f = filterWithReasons(candidates)
  }
  if (f.accepted.length < 2) {
    const seeds = topicSeeds(query)
    candidates = [...candidates, ...seeds]
    f = filterWithReasons(candidates)
  }
  const limit = pLimit(3)
  const fetched = await Promise.all(f.accepted.slice(0, 6).map(u => limit(() => fetchAndExtract(u).catch(() => null))))
  const valid = fetched.filter(x => x && x.content && x.content.text && x.content.text.length > MIN_CONTENT)
  const refs = valid.slice(0, 2)
  return { refs, decision: { query, accepted: valid.map(v => v.url), rejected: f.rejected, searx_validation: lastSearxAnalysis } }
}

function topicSeeds(title) {
  const t = String(title).toLowerCase()
  if (t.includes('live chat') && t.includes('chatbot')) {
    return [
      'https://freshdesk.com/customer-engagement/chatbots-vs-live-chat-blog/',
      'https://www.zendesk.com/blog/chatbots-vs-live-chat/'
    ]
  }
  if (t.includes('customer service') && t.includes('issues')) {
    return [
      'https://www.zendesk.com/blog/common-customer-service-problems/',
      'https://www.helpscout.com/blog/customer-service-problems/'
    ]
  }
  if (t.includes('customer service') && t.includes('platform')) {
    return [
      'https://www.zendesk.com/blog/customer-service-platform/',
      'https://freshdesk.com/customer-service/software/customer-service-platform-blog/'
    ]
  }
  if (t.includes('e-commerce') && t.includes('chatbot')) {
    return [
      'https://www.shopify.com/blog/chatbots',
      'https://www.bigcommerce.com/blog/chatbots/'
    ]
  }
  if (t.includes('sales hero')) {
    return [
      'https://www.salesforcesearch.com/blog/httpwww-salesforcesearch-combid1826183-tips-to-transforming-yourself-from-a-sales-zero-to-hero/',
      'https://milkshakehairpro.com/blogs/news/how-to-use-a-hero-strategy-to-boost-retail-sales'
    ]
  }
  return [
    'https://en.wikipedia.org/wiki/Chatbot',
    'https://www.ibm.com/think/topics/chatbots'
  ]
}

async function main() {
  const args = process.argv.slice(2)
  const mode = (args.find(a => a.startsWith('--mode=')) || '--mode=latest').split('=')[1]
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limitNum = limitArg ? Number(limitArg.split('=')[1]) : 5
  const idArg = args.find(a => a.startsWith('--id='))
  const targetId = idArg ? Number(idArg.split('=')[1]) : null
  const skipArg = args.find(a => a.startsWith('--skip='))
  const skipNum = skipArg ? Math.max(0, Number(skipArg.split('=')[1])) : 0
  if (mode === 'all') {
    const all = await fetchAllArticles()
    const originals = all.filter(a => (a.source || '').toLowerCase() === 'beyondchats')
    let processed = 0
    for (const art of originals) {
      if (processed >= limitNum) break
      if (alreadyHasUpdated(all, art)) {
        const base = normalizeBaseUrl(art.url || '')
        const existing = latestUpdatedForBase(all, base)
        if (!existing) {
          continue
        }
        const { refs, decision } = await findReferences(art.title)
        if (refs.length < 2) {
          process.stdout.write(JSON.stringify({ article_id: art.id, title: art.title, reason: 'insufficient_refs', decision }))
          continue
        }
        const rewritten = await rewriteWithLLM(art, refs)
        const citation = `\n\nReferences:\n1. ${refs[0].url}\n2. ${refs[1].url}\n`
        const updatedContent = rewritten + citation
        const payload = {
          title: art.title,
          url: `${art.url}?updated=${Date.now()}`,
          author: art.author || '',
          image_url: art.image_url || '',
          excerpt: art.excerpt || '',
          content: updatedContent,
          published_at: art.published_at || null,
          source: 'BeyondChats-Updated'
        }
        const updated = await updateArticle(existing.id, payload)
        processed++
        process.stdout.write(JSON.stringify({ updated_id: updated.id, article_id: art.id, title: art.title, refs: refs.map(r => r.url), decision, llm: LLM_PROVIDER }))
        continue
      }
      const { refs, decision } = await findReferences(art.title)
      if (refs.length < 2) {
        process.stdout.write(JSON.stringify({ article_id: art.id, title: art.title, reason: 'insufficient_refs', decision }))
        continue
      }
      const rewritten = await rewriteWithLLM(art, refs)
      const citation = `\n\nReferences:\n1. ${refs[0].url}\n2. ${refs[1].url}\n`
      const updatedContent = rewritten + citation
      const payload = {
        title: art.title,
        url: `${art.url}?updated=${Date.now()}`,
        author: art.author || '',
        image_url: art.image_url || '',
        excerpt: art.excerpt || '',
        content: updatedContent,
        published_at: art.published_at || null,
        source: 'BeyondChats-Updated'
      }
      const created = await createArticle(payload)
      processed++
      process.stdout.write(JSON.stringify({ created_id: created.id, article_id: art.id, title: art.title, refs: refs.map(r => r.url), decision, llm: LLM_PROVIDER }))
    }
    return
  } else if (mode === 'update-five') {
    const all = await fetchAllArticles()
    const deleted = await cleanupUpdatedDuplicates(all)
    const targets = fiveOldestOriginals(all)
    const results = []
    for (const art of targets) {
      const base = normalizeBaseUrl(art.url || '')
      const existing = latestUpdatedForBase(all, base)
      const { refs, decision } = await findReferences(art.title)
      if (refs.length < 2) {
        results.push({ article_id: art.id, title: art.title, reason: 'insufficient_refs', decision })
        continue
      }
      const rewritten = await rewriteWithLLM(art, refs)
      const citation = `\n\nReferences:\n1. ${refs[0].url}\n2. ${refs[1].url}\n`
      const updatedContent = rewritten + citation
      const payload = {
        title: art.title,
        url: `${art.url}?updated=${Date.now()}`,
        author: art.author || '',
        image_url: art.image_url || '',
        excerpt: art.excerpt || '',
        content: updatedContent,
        published_at: art.published_at || null,
        source: 'BeyondChats-Updated'
      }
      if (existing) {
        const updated = await updateArticle(existing.id, payload)
        results.push({ updated_id: updated.id, article_id: art.id, title: art.title, refs: refs.map(r => r.url), decision, llm: LLM_PROVIDER })
      } else {
        const created = await createArticle(payload)
        results.push({ created_id: created.id, article_id: art.id, title: art.title, refs: refs.map(r => r.url), decision, llm: LLM_PROVIDER })
      }
    }
    process.stdout.write(JSON.stringify({ deleted_duplicates: deleted, processed: results }))
    return
  } else if (mode === 'dedupe') {
    const all = await fetchAllArticles()
    const deleted = await cleanupUpdatedDuplicates(all)
    process.stdout.write(JSON.stringify({ deleted }))
    return
  } else if (mode === 'one') {
    let art = null
    if (targetId) {
      art = await fetchArticleById(targetId)
    } else {
      const all = await fetchAllArticles()
      const targets = fiveOldestOriginals(all)
      art = targets[skipNum] || targets[0]
    }
    if (!art) {
      throw new Error('No target article')
    }
    const { refs, decision } = await findReferences(art.title)
    if (refs.length < 2) {
      process.stdout.write(JSON.stringify({ article_id: art.id, title: art.title, reason: 'insufficient_refs', decision }))
      return
    }
    const rewritten = await rewriteWithLLM(art, refs)
    const citation = `\n\nReferences:\n1. ${refs[0].url}\n2. ${refs[1].url}\n`
    const updatedContent = rewritten + citation
    const payload = {
      title: art.title,
      url: `${art.url}?updated=${Date.now()}`,
      author: art.author || '',
      image_url: art.image_url || '',
      excerpt: art.excerpt || '',
      content: updatedContent,
      published_at: art.published_at || null,
      source: 'BeyondChats-Updated'
    }
    const base = normalizeBaseUrl(art.url || '')
    const all = await fetchAllArticles()
    const existing = latestUpdatedForBase(all, base)
    if (existing) {
      const updated = await updateArticle(existing.id, payload)
      process.stdout.write(JSON.stringify({ updated_id: updated.id, article_id: art.id, title: art.title, refs: refs.map(r => r.url), decision, llm: LLM_PROVIDER }))
    } else {
      const created = await createArticle(payload)
      process.stdout.write(JSON.stringify({ created_id: created.id, article_id: art.id, title: art.title, refs: refs.map(r => r.url), decision, llm: LLM_PROVIDER }))
    }
    return
  } else {
    const latest = await fetchLatestArticle()
    const { refs, decision } = await findReferences(latest.title)
    if (refs.length < 2) throw new Error('Insufficient reference articles')
    const rewritten = await rewriteWithLLM(latest, refs)
    const citation = `\n\nReferences:\n1. ${refs[0].url}\n2. ${refs[1].url}\n`
    const updatedContent = rewritten + citation
    const payload = {
      title: latest.title,
      url: `${latest.url}?updated=${Date.now()}`,
      author: latest.author || '',
      image_url: latest.image_url || '',
      excerpt: latest.excerpt || '',
      content: updatedContent,
      published_at: latest.published_at || null,
      source: 'BeyondChats-Updated'
    }
    const created = await createArticle(payload)
    process.stdout.write(JSON.stringify({ created_id: created.id, title: created.title, refs: refs.map(r => r.url), decision, llm: LLM_PROVIDER }))
  }
}

async function simpleRewrite(original, references) {
  const a = references[0]?.content?.text || ''
  const b = references[1]?.content?.text || ''
  const base = (original.content || original.excerpt || '').trim()
  const title = original.title
  const merged = [title, '\n', a.slice(0, 2000), '\n', base.slice(0, 5000), '\n', b.slice(0, 2000)].join('\n')
  return merged
}

main().catch(async e => {
  if (String(e).includes('Insufficient reference articles')) {
    try {
      const latest = await fetchLatestArticle()
      const sel = await googleSearch(`${latest.title} -site:beyondchats.com`)
      const limit = pLimit(3)
      const candidates = await Promise.all(sel.slice(0, 10).map(u => limit(() => fetchAndExtract(u))))
      const valid = candidates.filter(x => x.content && x.content.text && x.content.text.length > MIN_CONTENT)
      let refs = valid.slice(0, 2)
      if (refs.length < 2) throw new Error('Insufficient reference fallback')
      const rewritten = client ? await rewriteWithLLM(latest, refs) : await simpleRewrite(latest, refs)
      const citation = `\n\nReferences:\n1. ${refs[0].url}\n2. ${refs[1].url}\n`
      const updatedContent = rewritten + citation
      const payload = {
        title: latest.title,
        url: `${latest.url}?updated=${Date.now()}`,
        author: latest.author || '',
        image_url: latest.image_url || '',
        excerpt: latest.excerpt || '',
        content: updatedContent,
        published_at: latest.published_at || null,
        source: 'BeyondChats-Updated'
      }
      const created = await createArticle(payload)
      process.stdout.write(JSON.stringify({ created_id: created.id, title: created.title, refs: refs.map(r => r.url), fallback: true, llm: LLM_PROVIDER }))
      process.exit(0)
    } catch (err) {
      process.stderr.write(String(err?.message || err))
      process.exit(1)
    }
  }
  process.stderr.write(String(e?.message || e))
  process.exit(1)
})
