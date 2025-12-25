<?php

namespace App\Console\Commands;

use App\Models\Article;
use Illuminate\Support\Str;
use Illuminate\Support\Carbon;
use Illuminate\Console\Command;

class ScrapeBeyondchatsBlogs extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'beyondchats:scrape {--limit=5}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Scrape the oldest articles from BeyondChats blogs and store them';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $limit = (int) $this->option('limit');
        if ($limit < 1) {
            $limit = 5;
        }
        $baseUrl = 'https://beyondchats.com/blogs/';
        $html = $this->fetchHtml($baseUrl);
        if (!$html) {
            $this->error('Failed to fetch blogs page');
            return 1;
        }
        $lastPage = $this->extractLastPageNumber($html);
        if (!$lastPage) {
            $this->warn('Could not determine last page, defaulting to page 1');
            $lastPage = 1;
        }
        $count = 0;
        $page = $lastPage;
        while ($page >= 1 && $count < $limit) {
            $pageUrl = rtrim($baseUrl, '/') . '/page/' . $page . '/';
            $pageHtml = $this->fetchHtml($pageUrl);
            if (!$pageHtml) {
                $this->warn('Failed to fetch page ' . $page);
                break;
            }
            $items = $this->parseArticles($pageHtml);
            if (empty($items)) {
                $this->warn('No articles found on page ' . $page);
                break;
            }
            foreach ($items as $item) {
                if ($count >= $limit) {
                    break;
                }
                if (!isset($item['url']) || !isset($item['title'])) {
                    continue;
                }
                $existing = Article::where('url', $item['url'])->first();
                if ($existing) {
                    $this->line('Skipping existing: ' . $item['title']);
                    continue;
                }
                $content = $this->fetchArticleContent($item['url']);
                $data = [
                    'title' => $item['title'],
                    'slug' => Str::slug($item['title']),
                    'url' => $item['url'],
                    'author' => $item['author'] ?? null,
                    'image_url' => $item['image_url'] ?? null,
                    'excerpt' => $item['excerpt'] ?? null,
                    'content' => $content,
                    'published_at' => isset($item['published_at']) ? Carbon::parse($item['published_at']) : null,
                    'source' => 'BeyondChats',
                ];
                Article::create($data);
                $this->info('Saved: ' . $item['title']);
                $count++;
            }
            $page--;
        }
        $this->info('Done. Inserted ' . $count . ' articles.');
        return 0;
    }

    protected function fetchHtml(string $url): ?string
    {
        $opts = [
            'http' => [
                'method' => 'GET',
                'header' => "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\nAccept: text/html\r\n",
                'timeout' => 20,
                'ignore_errors' => true,
            ],
        ];
        $context = stream_context_create($opts);
        $html = @file_get_contents($url, false, $context);
        return $html ?: null;
    }

    protected function extractLastPageNumber(string $html): ?int
    {
        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML($html);
        libxml_clear_errors();
        $xpath = new \DOMXPath($dom);
        $nodes = $xpath->query("//nav[contains(@class,'ct-pagination')]//a[contains(@class,'page-numbers')]");
        $max = null;
        foreach ($nodes as $a) {
            $text = trim($a->textContent ?? '');
            if (preg_match('/^\\d+$/', $text)) {
                $n = (int) $text;
                if ($max === null || $n > $max) {
                    $max = $n;
                }
            }
        }
        return $max;
    }

    protected function parseArticles(string $html): array
    {
        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML($html);
        libxml_clear_errors();
        $xpath = new \DOMXPath($dom);
        $articles = [];
        $nodes = $xpath->query("//article[contains(@class,'entry-card')]");
        foreach ($nodes as $node) {
            $titleAnchor = $xpath->query(".//h2[contains(@class,'entry-title')]/a", $node)->item(0);
            $title = $titleAnchor ? trim($titleAnchor->textContent) : null;
            $url = $titleAnchor ? trim($titleAnchor->getAttribute('href')) : null;
            $time = $xpath->query(".//li[contains(@class,'meta-date')]//time", $node)->item(0);
            $published = $time ? ($time->getAttribute('datetime') ?: trim($time->textContent)) : null;
            $author = null;
            $authorNode = $xpath->query(".//li[contains(@class,'meta-author')]//*[self::span or self::a]", $node)->item(0);
            if ($authorNode) {
                $author = trim($authorNode->textContent);
            }
            $img = $xpath->query(".//a[contains(@class,'ct-media-container')]//img", $node)->item(0);
            $imageUrl = $img ? trim($img->getAttribute('src')) : null;
            $excerptNode = $xpath->query(".//div[contains(@class,'entry-excerpt')]", $node)->item(0);
            $excerpt = $excerptNode ? trim(preg_replace('/\\s+/', ' ', $excerptNode->textContent)) : null;
            $articles[] = [
                'title' => $title,
                'url' => $url,
                'published_at' => $published,
                'author' => $author,
                'image_url' => $imageUrl,
                'excerpt' => $excerpt,
            ];
        }
        return $articles;
    }

    protected function fetchArticleContent(string $url): ?string
    {
        $html = $this->fetchHtml($url);
        if (!$html) {
            return null;
        }
        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML($html);
        libxml_clear_errors();
        $xpath = new \DOMXPath($dom);
        $contentNode = $xpath->query("//div[contains(@class,'elementor-widget-theme-post-content')]")->item(0);
        if (!$contentNode) {
            $contentNode = $xpath->query("//article[contains(@class,'post')]")->item(0);
        }
        if (!$contentNode) {
            $contentNode = $xpath->query("//main")->item(0);
        }
        if (!$contentNode) {
            return null;
        }
        $text = trim(preg_replace('/\\s+/', ' ', $contentNode->textContent ?? ''));
        return $text ?: null;
    }
}
