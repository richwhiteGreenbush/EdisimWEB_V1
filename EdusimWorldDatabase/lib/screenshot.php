<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/*
 * Screenshot handling.
 *
 * The uploaded bytes are NEVER what gets stored. Every accepted image is decoded with GD
 * and re-encoded to a fresh JPEG, which is the one reliable way to be sure that what
 * lands in a web-served directory is an image and nothing else: a file can be a valid
 * PNG and a valid PHP script at the same time (the classic polyglot), and a check on the
 * extension, the browser-supplied MIME type, or even getimagesize() alone will pass it.
 * Decoding to a pixel buffer and writing a new file from those pixels discards everything
 * that was not pixels -- appended payloads, EXIF, embedded scripts -- for free.
 *
 * Two files come out of one upload: a display image and a thumbnail. The gallery shows
 * twelve cards at a time, and twelve 1600px JPEGs is several megabytes for a page that
 * displays each of them 400px wide.
 */

/**
 * @return array{ok: bool, error: string, path: string, thumb: string, width: int, height: int}
 */
function ewd_store_screenshot(array $file, string $slug): array
{
    $fail = static fn (string $msg): array => [
        'ok' => false, 'error' => $msg, 'path' => '', 'thumb' => '', 'width' => 0, 'height' => 0,
    ];

    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return $fail(ewd_upload_error_message((int)($file['error'] ?? UPLOAD_ERR_NO_FILE)));
    }

    $tmp = (string)($file['tmp_name'] ?? '');
    // The one check that proves these bytes came from this request's upload rather than
    // being any path a crafted field asked PHP to read.
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        return $fail('That upload did not arrive properly. Try again.');
    }

    $size = (int)($file['size'] ?? 0);
    if ($size <= 0) {
        return $fail('That screenshot file is empty.');
    }
    if ($size > EWD_MAX_SHOT_BYTES) {
        return $fail('That screenshot is ' . ewd_bytes($size) . '. The limit is '
            . ewd_bytes(EWD_MAX_SHOT_BYTES) . ' — try saving it as a JPEG.');
    }

    $info = @getimagesize($tmp);
    if ($info === false) {
        return $fail('That file is not an image. Take a screenshot of your world and upload the picture.');
    }

    [$width, $height, $type] = [$info[0], $info[1], $info[2]];

    if (!in_array($type, [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF], true)) {
        return $fail('Screenshots must be a JPEG, PNG, WebP or GIF.');
    }
    if ($width < 200 || $height < 150) {
        return $fail('That picture is only ' . $width . '×' . $height . '. A screenshot should be at least 200×150.');
    }

    // A "decompression bomb" is a small file that expands to an enormous bitmap and
    // exhausts memory during decode. The pixel count is knowable from the header, before
    // a single pixel is allocated, so it is checked here rather than discovered by the
    // process being killed.
    if ($width * $height > 50_000_000) {
        return $fail('That image is far too large to process. Please resize it first.');
    }

    if (!function_exists('imagecreatefromstring')) {
        return $fail('This server has no image support installed (PHP’s GD extension). Ask whoever set this up.');
    }

    $raw = file_get_contents($tmp);
    if ($raw === false) {
        return $fail('The screenshot could not be read.');
    }

    $src = @imagecreatefromstring($raw);
    unset($raw);
    if ($src === false) {
        return $fail('That image could not be opened. Try saving it again as a JPEG or PNG.');
    }

    try {
        ewd_ensure_dirs();

        $stem  = $slug . '-' . bin2hex(random_bytes(6));
        $name  = $stem . '.jpg';
        $thumb = $stem . '-thumb.jpg';

        $main = ewd_resize_to_fit($src, EWD_SHOT_MAX_W, EWD_SHOT_MAX_H);
        $outW = imagesx($main);
        $outH = imagesy($main);
        $ok = imagejpeg($main, EWD_SHOT_DIR . '/' . $name, EWD_JPEG_QUALITY);

        if (!$ok) {
            imagedestroy($main);
            return $fail('The screenshot could not be saved. Check the uploads folder is writable.');
        }

        $thumbImg = ewd_resize_to_fit($main, EWD_THUMB_MAX_W, EWD_THUMB_MAX_H);
        if (!imagejpeg($thumbImg, EWD_SHOT_DIR . '/' . $thumb, EWD_JPEG_QUALITY)) {
            // A missing thumbnail is a slow page, not a broken one -- the cards and the
            // detail page both fall back to the full image when this is empty.
            $thumb = '';
        }
        imagedestroy($thumbImg);
        imagedestroy($main);

        @chmod(EWD_SHOT_DIR . '/' . $name, 0644);
        if ($thumb !== '') {
            @chmod(EWD_SHOT_DIR . '/' . $thumb, 0644);
        }

        return ['ok' => true, 'error' => '', 'path' => $name, 'thumb' => $thumb,
                'width' => $outW, 'height' => $outH];
    } finally {
        imagedestroy($src);
    }
}

/**
 * Scale to fit inside a box, preserving aspect. ALWAYS returns a new image, even when
 * the source already fits and nothing needs scaling -- so the caller always owns the
 * result and can always destroy it, with no identity comparison to get wrong.
 *
 * Returning the source untouched in the already-fits case would also skip the white
 * fill below, and every output here is a JPEG: a small transparent PNG would then be
 * written with black wherever it was see-through, while a large one came out correctly.
 */
function ewd_resize_to_fit(GdImage $src, int $maxW, int $maxH): GdImage
{
    $w = imagesx($src);
    $h = imagesy($src);

    $scale = min(1.0, $maxW / $w, $maxH / $h);
    $newW = max(1, (int)round($w * $scale));
    $newH = max(1, (int)round($h * $scale));

    $dst = imagecreatetruecolor($newW, $newH);

    // JPEG has no alpha channel, and a fresh truecolor canvas starts black -- so any
    // transparency in the source has to be composited onto something before it is
    // written. White is what a screenshot with a see-through border should look like.
    $white = imagecolorallocate($dst, 255, 255, 255);
    imagefilledrectangle($dst, 0, 0, $newW, $newH, $white);

    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $w, $h);

    return $dst;
}
