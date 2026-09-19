<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/*
 * Teacher tools: one shared password, held in a session.
 *
 * There are no user accounts anywhere in this app -- a class of nine-year-olds sharing
 * worlds does not need logins, and every account is a password a child can lose and an
 * email address this project would then be storing. One staff password guarding the
 * moderation queue is the whole authentication story.
 *
 * The password itself is never in the codebase: config.php ships EWD_ADMIN_PASSWORD_HASH
 * empty, and admin.php's setup screen prints the line to paste into config.local.php.
 */

function ewd_admin_configured(): bool
{
    return EWD_ADMIN_PASSWORD_HASH !== '';
}

function ewd_is_admin(): bool
{
    if (!ewd_admin_configured()) {
        return false;
    }
    ewd_session();

    // The session remembers WHICH hash it was granted against, so changing the password
    // in config.local.php immediately invalidates every session opened with the old one.
    // Without this, a leaked password stays usable for as long as a browser keeps its
    // cookie, however fast it is changed.
    return ($_SESSION['admin_for'] ?? null) === EWD_ADMIN_PASSWORD_HASH;
}

function ewd_admin_login(string $password): bool
{
    if (!ewd_admin_configured()) {
        return false;
    }
    if (!password_verify($password, EWD_ADMIN_PASSWORD_HASH)) {
        return false;
    }
    ewd_session();

    // A new session id at the moment privilege changes, so a session id an attacker
    // planted before the login cannot be the one that ends up logged in.
    session_regenerate_id(true);
    $_SESSION['admin_for'] = EWD_ADMIN_PASSWORD_HASH;
    return true;
}

function ewd_admin_logout(): void
{
    ewd_session();
    unset($_SESSION['admin_for']);
    session_regenerate_id(true);
}

function ewd_require_admin(): void
{
    if (!ewd_is_admin()) {
        ewd_redirect('admin.php');
    }
}

/**
 * Deliberately slow on a wrong password. A shared staff password is the one credential
 * here worth guessing, and there is no account to lock -- so a failed attempt costs the
 * guesser most of a second, which turns an online brute force into something that would
 * take years while a teacher typing it wrong once barely notices.
 */
function ewd_login_delay(): void
{
    usleep(400_000);
}
