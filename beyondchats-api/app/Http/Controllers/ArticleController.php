<?php

namespace App\Http\Controllers;

use App\Models\Article;
use Illuminate\Http\Request;

class ArticleController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $query = Article::query()->orderByDesc('published_at')->orderByDesc('id');
        $perPage = (int) request()->query('per_page', 15);
        $articles = $query->paginate($perPage);
        return response()->json($articles);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'slug' => ['nullable', 'string', 'max:255'],
            'url' => ['required', 'url', 'max:2048', 'unique:articles,url'],
            'author' => ['nullable', 'string', 'max:255'],
            'image_url' => ['nullable', 'string', 'max:2048'],
            'excerpt' => ['nullable', 'string'],
            'content' => ['nullable', 'string'],
            'published_at' => ['nullable', 'date'],
            'source' => ['nullable', 'string', 'max:255'],
        ]);
        if (!isset($data['slug']) && isset($data['title'])) {
            $data['slug'] = str($data['title'])->slug();
        }
        $article = Article::create($data);
        return response()->json($article, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        $article = Article::findOrFail($id);
        return response()->json($article);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        $article = Article::findOrFail($id);
        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'slug' => ['nullable', 'string', 'max:255'],
            'url' => ['sometimes', 'url', 'max:2048', 'unique:articles,url,'.$article->id],
            'author' => ['nullable', 'string', 'max:255'],
            'image_url' => ['nullable', 'string', 'max:2048'],
            'excerpt' => ['nullable', 'string'],
            'content' => ['nullable', 'string'],
            'published_at' => ['nullable', 'date'],
            'source' => ['nullable', 'string', 'max:255'],
        ]);
        if (!isset($data['slug']) && isset($data['title'])) {
            $data['slug'] = str($data['title'])->slug();
        }
        $article->fill($data);
        $article->save();
        return response()->json($article);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        $article = Article::findOrFail($id);
        $article->delete();
        return response()->json(['status' => 'deleted']);
    }
}
