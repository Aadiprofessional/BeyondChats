<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Article extends Model
{
    protected $fillable = [
        'title',
        'slug',
        'url',
        'author',
        'image_url',
        'excerpt',
        'content',
        'published_at',
        'source',
    ];

    protected $casts = [
        'published_at' => 'datetime',
    ];
}
