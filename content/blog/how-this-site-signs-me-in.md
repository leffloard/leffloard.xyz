---
title: How the admin of this site signs me in
description: Passkeys, one-time codes, lockouts that cannot lock me out, and why the design assumes my password will leak one day.
date: 2026-09-26
tags: security, nextjs
---

The admin behind this site will hold client briefs, invoices and payment settings. So I designed its sign-in around one assumption: **one day, my password will leak.** Maybe through a phishing page, maybe through another site's breach. The question is what an attacker can do with it then. The answer should be: nothing.

Here is how it works, layer by layer.

## A password is never enough

Passwords are hashed with **argon2id** (19 MiB of memory, two passes), the current recommendation for new systems. When someone signs in with an email address that has no account, the server still checks the password against a dummy hash, so both answers take the same time and the response time does not reveal which addresses exist.

A correct password does not start a session. It only unlocks the second step: a code from an authenticator app. The very first sign-in sets up the authenticator before any session exists, so there is never a moment where the admin is reachable with a password alone.

## Every code works once

Authenticator codes (TOTP) change every 30 seconds, and the server accepts one step of clock drift either way. That still leaves a window in which a code someone watched you type could be replayed. To close it, the server remembers the last time step it accepted, and only a newer step can succeed:

```ts
const result = await users.updateOne(
  { _id: user._id, "totp.lastUsedStep": { $lt: step } },
  { $set: { "totp.lastUsedStep": step } },
);
return result.modifiedCount === 1;
```

The condition lives in the database update itself, so two requests racing with the same code cannot both win. Recovery codes use the same trick: ten single-use codes, stored only as keyed hashes. The hashing key comes from the server's encryption key, so a copy of the database alone is not enough to use or guess them.

## Passkeys, and a lockout that cannot lock me out

Guessing is limited twice. Each address gets 20 attempts per 15 minutes, and each email address has a progressive lock: 15 minutes from the fifth failure, an hour from the tenth, a day from the twentieth. Unknown addresses lock the same way, so a lock reveals nothing either.

A lockout is also a weapon, though: anyone who knows my email could keep me out by failing on purpose. That is where **passkeys** come in. A passkey (Windows Hello, Touch ID, a phone) proves both "something I have" and "something I am", so it signs in on its own, and it ignores the password lock. The attacker can lock the password door; the passkey door stays open for me.

## Sessions that do not outlive their welcome

The session cookie holds a random 256-bit token, and the database stores only its SHA-256. A leaked database backup therefore contains no working sessions. Cookies use the `__Host-` prefix, which forces them to be Secure, set for the whole site and bound to this exact host, so no subdomain can overwrite them; they are also HttpOnly, so page scripts cannot read them. Sessions end after 30 minutes without activity and after 12 hours at most, and the Security page lists every device with a button to sign it out.

Signing in is not permission to change everything. Changing the password, the authenticator, the recovery codes or the passkeys asks me to **confirm it's me** again (password and code, or a passkey), and that confirmation lasts ten minutes. A stolen session cookie cannot quietly add the attacker's own passkey.

## Scripts only from this page

Every admin page is sent with a Content Security Policy that allows only scripts carrying a random nonce generated for that single request. An injected `<script>` tag has no nonce and never runs. The browser tests fail if any page reports a single CSP violation, so a regression is caught before it ships.

## Tested like it matters

Security code that is not tested is a hope, not a control. The TOTP implementation is checked against the test vectors in RFC 6238. Integration tests run against a real MongoDB replica set and race two requests with the same recovery code to prove only one wins. Browser tests walk through the first-time setup, wrong codes, recovery codes, signing out other devices and the confirm-it's-you dialog, and they sign in with a passkey through Chrome's virtual authenticator.

## What I left out on purpose

- **SMS codes**, because a SIM swap turns them into a password reset for whoever talks the operator into it.
- **Security questions**, because the answers are usually public or guessable.
- **"Remember this device for 30 days"**, for now. It is convenient, and it is also a long-lived key sitting in a browser.

None of this is exotic. It is a stack of well-understood controls, each one covering the gap the previous one leaves. That is also how I build sign-in for clients.
