# BeyondChats

An end-to-end monorepo that:
- Scrapes the 5 oldest blog posts from `https://beyondchats.com/blogs/` into a Laravel API
- Rewrites articles with AI (Groq/OpenAI) using top external references
- Publishes updated articles back to the API with citations
- Shows originals and updates side-by-side in a small React UI

## Repo Layout
- `beyondchats-api/` – Laravel app with Articles CRUD and the scraper command
- `content-updater/` – NodeJS script that searches, scrapes, rewrites, and publishes updates
- `articles-frontend/` – React + Vite frontend to browse originals and updated versions

## Local Setup
1) Requirements
- PHP 8.2+, Composer, Node 18+, npm, SQLite (or MySQL), Git

2) Backend (Laravel)
- `cd beyondchats-api`
- `cp .env.example .env`
- In `.env`, set `DB_CONNECTION=sqlite` and ensure `database/database.sqlite` exists
- `composer install`
- `php artisan key:generate`
- `php artisan migrate`
- Scrape oldest 5 BeyondChats articles: `php artisan beyondchats:scrape --limit=5`
- Start API: `php artisan serve --host=127.0.0.1 --port=8001`

3) Updater (NodeJS + Groq/OpenAI)
- `cd content-updater`
- `npm install`
- Create `.env` with:
  - `API_BASE_URL=http://127.0.0.1:8001`
  - `GROQ_API_KEY=YOUR_KEY` (preferred), or `OPENAI_API_KEY=YOUR_KEY`
- Update the five oldest originals: `API_BASE_URL=http://127.0.0.1:8001 npm start -- --mode=update-five`
- If duplicates exist: `API_BASE_URL=http://127.0.0.1:8001 npm start -- --mode=dedupe`
- Run one-by-one when needed: `API_BASE_URL=http://127.0.0.1:8001 npm start -- --mode=one --skip=0..4`

4) Frontend (React)
- `cd articles-frontend`
- `npm install`
- `VITE_API_BASE_URL=http://127.0.0.1:8001 npm run dev`
- Open `http://localhost:5173/`

## Live Link
- Local preview: `http://localhost:5173/` (uses `VITE_API_BASE_URL`)
- For a public link, deploy `articles-frontend` to Vercel/Netlify and set `VITE_API_BASE_URL` to your live Laravel API URL

## How It Works
1) Laravel scraper pulls titles, URLs, metadata, and page content from the last blogs page and stores as `source=BeyondChats`.
2) The updater script:
   - Finds external references via Google/Bing (SearXNG fallback)
   - Scrapes main content from 2 strong references
   - Calls an LLM (Groq preferred) to rewrite the original for better structure and web readability
   - Appends a “References” block and publishes an updated record (`source=BeyondChats-Updated`) with `?updated=<timestamp>` in URL
3) The frontend groups items by base URL and renders:
   - The original and any updated versions side-by-side
   - A clean card UI with an Updated badge and clickable citations

## Architecture Diagram
```
┌─────────────────────────────────────────────────────────────────────┐
│                         BeyondChats Monorepo                         │
└─────────────────────────────────────────────────────────────────────┘
      scrape               CRUD + pagination           browse
┌───────────────┐       ┌────────────────────┐      ┌─────────────────┐
│ Laravel CLI   │  ---> │ Laravel API        │ <--- │ React Frontend  │
│ (beyondchats: │       │ /api/articles      │      │ (Vite)          │
│ scrape)       │       │                    │      │                 │
└───────────────┘       └────────────────────┘      └─────────────────┘
                               ▲       ▲
                               │       │
                               │       │ publish updates
                               │       └───────────────┐
                               │                       │
                         read originals                │
                               │                       │
                         ┌─────────────────────────────────────────┐
                         │ Node Updater (Groq/OpenAI)              │
                         │ - Google/Bing search                    │
                         │ - Scrape 2 references                   │
                         │ - LLM rewrite + citations               │
                         │ - Create/Update article via API         │
                         └─────────────────────────────────────────┘
```

## API Endpoints
- `GET /api/articles?page=1&per_page=50` – Paginated list
- `POST /api/articles` – Create
- `PATCH /api/articles/{id}` – Update
- `DELETE /api/articles/{id}` – Delete

## Running the Submission Flow
- Scrape: `php artisan beyondchats:scrape --limit=5`
- Update all five: `API_BASE_URL=http://127.0.0.1:8001 npm start -- --mode=update-five`
- Verify in the frontend at `http://localhost:5173/`

## Notes
- The updater prefers Groq (`GROQ_API_KEY`) and falls back to OpenAI or a simple merger.
- Citations are displayed at the bottom of updated articles in the UI.
- The UI groups by base URL so repeated “UPDATED” entries do not clutter the view.

## GitHub
Initialize and push:
```
git init
echo "# BeyondChats" >> README.md
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/Aadiprofessional/BeyondChats.git
git push -u origin main
```
If push prompts for credentials, use a personal access token or `gh auth login`.

## Submission Checklist
- Completeness: Laravel scrape + API, updater publishes 5 updated articles with citations, React UI grouping
- ReadMe & setup docs: Included above with clear steps
- Live Link: Local development URL; deploy to Vercel/Netlify for public review
- Code Quality: Typed where relevant, modular Node script, clean React components and styles

# BeyondChats
