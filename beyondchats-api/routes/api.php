<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ArticleController;

Route::middleware('api')->group(function () {
    Route::apiResource('articles', ArticleController::class);
});
