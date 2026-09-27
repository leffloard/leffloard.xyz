# v1 test parity

The v1 backend's suite (`tests/test_requests_api.py`, 160 cases with parameters: 159 passed and 1 skipped
on Python < 3.13) is the specification for the new intake. This file maps every v1 test to where the same
behaviour is checked now.

- **Ported**: the same behaviour, checked by the named test.
- **Adapted**: the behaviour changed on purpose; the reason is given.
- **Replaced**: the v1 feature is gone, and its replacement has its own tests.
- **Not applicable**: v1 plumbing that has no counterpart in a Next.js app.

Paths are relative to `tests/`. `unit/intake-legacy` is `unit/intake-legacy.test.ts`, and so on.

## Public endpoints (80)

| v1 test                                                                | Cases | Status         | Now                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ----- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| test_health                                                            | 1     | Ported         | integration/health-route › the shallow check (same `{ ok: true }`)                                                                                                                                                               |
| test_template_endpoints_are_gone                                       | 3     | Ported         | unit/api-errors › unknown API addresses answer with JSON (GET, POST, …)                                                                                                                                                          |
| test_create_appointment_stores_document                                | 1     | Adapted        | integration/requests-route › stores an appointment and answers like v1. Same answer; the document is an inbox message (`kind: "call"`, service slug) instead of a v1 request.                                                    |
| test_create_inquiry_with_only_required_fields                          | 1     | Ported         | unit/intake-legacy › accepts an inquiry with only the required fields; integration/requests-route › stores a question                                                                                                            |
| test_appointment_fields_are_ignored_for_other_types                    | 1     | Ported         | unit/intake-legacy › ignores appointment fields for other types                                                                                                                                                                  |
| test_strings_are_stripped_and_empty_optionals_become_null              | 1     | Ported         | unit/intake-legacy › strips strings and turns empty optional fields into null                                                                                                                                                    |
| test_revision_requires_project_reference                               | 1     | Ported         | unit/intake-legacy › requires the project name for a revision                                                                                                                                                                    |
| test_appointment_requires_date_time_and_timezone                       | 1     | Ported         | unit/intake-legacy › requires date, time and time zone for an appointment                                                                                                                                                        |
| test_common_required_fields                                            | 1     | Ported         | unit/intake-legacy › lists every missing common field; integration/requests-route › lists every field problem with v1's 422 format                                                                                               |
| test_field_rules                                                       | 14    | Ported         | unit/intake-legacy › refuses %s = %j (the same 14 cases)                                                                                                                                                                         |
| test_limits_are_inclusive                                              | 1     | Ported         | unit/intake-legacy › includes the limits themselves (plus: counts characters like Python)                                                                                                                                        |
| test_every_listed_service_is_accepted                                  | 5     | Ported         | unit/intake-legacy › accepts the listed service %s                                                                                                                                                                               |
| test_control_characters_are_rejected                                   | 4     | Ported         | unit/intake-legacy › refuses control characters in %s                                                                                                                                                                            |
| test_message_allows_newlines_and_tabs_but_not_other_control_characters | 1     | Ported         | unit/intake-legacy › keeps line breaks and tabs in the message                                                                                                                                                                   |
| test_date_bounds                                                       | 1     | Ported         | unit/intake-legacy › allows today and up to 120 days ahead (with a fixed clock)                                                                                                                                                  |
| test_date_bounds_use_the_client_timezone                               | 1     | Ported         | unit/intake-legacy › uses the visitor's time zone for today                                                                                                                                                                      |
| test_bad_dates                                                         | 6     | Ported         | unit/intake-legacy › refuses the date %j                                                                                                                                                                                         |
| test_bad_times                                                         | 6     | Ported         | unit/intake-legacy › refuses the time %j                                                                                                                                                                                         |
| test_midnight_is_a_valid_time                                          | 1     | Ported         | unit/intake-legacy › accepts midnight                                                                                                                                                                                            |
| test_bad_timezones                                                     | 6     | Ported         | unit/intake-legacy › refuses the time zone %j                                                                                                                                                                                    |
| test_duration                                                          | 1     | Ported         | unit/intake-legacy › defaults the duration to 30 minutes and accepts only 15, 30, 45 or 60                                                                                                                                       |
| test_invalid_json_and_non_object_bodies                                | 1     | Ported         | integration/requests-route › explains a body that is not a JSON object                                                                                                                                                           |
| test_honeypot_returns_fake_success_and_stores_nothing                  | 1     | Ported         | integration/requests-route › answers a filled honeypot with a fake success; integration/inquiries-route › drops what the honeypot catches                                                                                        |
| test_honeypot_is_never_stored                                          | 1     | Ported         | integration/requests-route › treats a blank honeypot as empty, and never stores it                                                                                                                                               |
| test_rate_limit                                                        | 1     | Ported         | integration/requests-route › allows five requests per address every ten minutes; integration/inquiries-route › limits each address                                                                                               |
| test_rate_limit_ignores_forwarded_for_unless_proxy_is_trusted          | 1     | Adapted        | integration/requests-route › behind Cloudflare, keys the limit on CF-Connecting-IP. `TRUST_PROXY` became `CLIENT_IP_SOURCE`: behind the Cloudflare Tunnel the address comes from Cloudflare's header, which visitors cannot set. |
| test_trusted_proxy_keys_on_the_address_it_appended                     | 1     | Adapted        | unit/ip › clientIp (M1). Same reason.                                                                                                                                                                                            |
| test_spoofed_forwarded_for_cannot_lock_out_another_address             | 1     | Replaced       | integration/rate-limit-lockout and integration/login (M1): sign-in limits and locks no longer depend on forwarded headers.                                                                                                       |
| test_same_machine_proxy_needs_no_trust_setting                         | 1     | Not applicable | Uvicorn's proxy-header middleware; Next.js has no equivalent setting.                                                                                                                                                            |
| test_client_key                                                        | 13    | Ported         | unit/ip › ipKey and clientIp cases (M1), including IPv6 /64 grouping and mapped IPv4                                                                                                                                             |
| test_rate_limiter_window_and_release                                   | 1     | Ported         | integration/rate-limit-lockout › sliding window and release (M1, now stored in MongoDB)                                                                                                                                          |

## Notifications (19)

| v1 test                                                                | Cases | Status  | Now                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| test_new_request_notifies_discord_and_email                            | 1     | Ported  | unit/notify-templates › Discord alerts describe a call request; › emails alert the owner; integration/requests-route › queues a Discord alert and an owner email                        |
| test_revision_and_inquiry_notification_titles                          | 1     | Adapted | unit/notify-templates › have a title per kind. "New inquiry" is now "New question", and project briefs are new.                                                                         |
| test_admin_link_is_omitted_without_site_url                            | 1     | Ported  | unit/notify-templates › leave out the admin link without a site address (Discord and email)                                                                                             |
| test_unconfigured_channels_are_skipped                                 | 4     | Ported  | integration/requests-route › skips channels that are not configured (the same 4 cases); unit/channels                                                                                   |
| test_notification_failures_do_not_affect_the_request                   | 1     | Adapted | integration/outbox › retries a failure with growing delays. Alerts go through the outbox, so a failure is retried instead of only logged, and the visitor's request never waits for it. |
| test_discord_payload_neutralises_mentions_and_markdown                 | 1     | Ported  | unit/notify-templates › can't ping anyone or hide links                                                                                                                                 |
| test_discord_payload_respects_size_limits                              | 1     | Ported  | unit/notify-templates › stay inside Discord's size limits (with the new, longer fields)                                                                                                 |
| test_post_webhook_raises_on_error_status                               | 1     | Ported  | unit/notify-templates › postDiscord fails on an error status                                                                                                                            |
| test_webhook_url_never_reaches_the_logs                                | 1     | Ported  | unit/notify-templates › names a network failure without the webhook address; integration/outbox › never stores or reports the webhook address                                           |
| test_emails_encode_non_ascii_text                                      | 1     | Ported  | unit/notify-email › encodes non-ASCII names, subjects and text                                                                                                                          |
| test_long_non_ascii_subject_survives_folding                           | 1     | Ported  | unit/notify-email › keeps a long non-ASCII subject intact (skipped in v1 on Python < 3.13; runs everywhere now)                                                                         |
| test_owner_and_client_emails_survive_line_separators_and_encoded_words | 2     | Ported  | unit/notify-email › can't be tricked into extra header lines by %j; unit/intake-legacy › turns Unicode line separators into line breaks                                                 |
| test_deliver_email_uses_configured_security                            | 3     | Ported  | unit/notify-email › connects with %s security                                                                                                                                           |

## Admin authentication (17)

v1 had one password and a bearer token. The new admin (M1) has argon2id passwords, mandatory two-step
sign-in, passkeys, sessions and locks, with their own tests.

| v1 test                                              | Cases | Status   | Now                                                                                                                                     |
| ---------------------------------------------------- | ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| test_admin_is_unavailable_when_not_configured        | 2     | Replaced | The admin always exists; `npm run admin -- create` makes the owner. The old `/api/admin/*` addresses answer 404 JSON (unit/api-errors). |
| test_login_success                                   | 1     | Replaced | integration/login, e2e/admin-auth                                                                                                       |
| test_login_failures                                  | 1     | Replaced | integration/login › gives the same answer for an unknown email and a wrong password                                                     |
| test_login_rate_limit                                | 1     | Replaced | integration/login › locks the address after five failures; e2e/admin-auth › repeated wrong passwords lock password sign-in              |
| test_password_matches_handles_long_and_invalid_input | 1     | Replaced | unit/password (argon2id, length rules)                                                                                                  |
| test_admin_requires_valid_token                      | 9     | Replaced | integration/login (sessions: expiry, idle timeout, revocation); e2e/admin-auth                                                          |
| test_token_is_rejected_after_secret_rotation         | 1     | Replaced | Sessions are server-side: signing out everywhere or changing the password revokes them (integration/login).                             |
| test_admin_me_reports_notification_channels          | 1     | Ported   | unit/channels › reports which channels work (the same three switches)                                                                   |

## Admin request management (24)

The v1 JSON API became the inbox pages and server actions; the behaviour lives in `server/inquiries/store.ts`.

| v1 test                                                           | Cases | Status  | Now                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| test_list_newest_first_with_counts                                | 1     | Ported  | integration/inbox › shows the newest first, with counts per status                                                                                                                         |
| test_list_filters_search_and_pagination                           | 1     | Ported  | integration/inbox › filters by status and kind, searches safely, and pages (the same regex-escaping cases)                                                                                 |
| test_list_rejects_bad_query                                       | 5     | Adapted | The inbox page ignores unknown filters and shows the default view instead of a 422 (app/(admin)/admin/(shell)/inbox/page.tsx); only listed views, kinds and page numbers reach the query.  |
| test_get_single_request                                           | 1     | Ported  | integration/inbox › reads only well-formed ids; the detail page answers 404 for unknown ids                                                                                                |
| test_patch_status_note_and_schedule                               | 1     | Ported  | integration/inbox › records status changes once, with the previous status; › schedules calls only                                                                                          |
| test_patch_accepts_utc_z_suffix                                   | 1     | Adapted | The call time is entered as date and time in the visitor's zone; unit/intake-rules › finds the moment of a wall-clock time                                                                 |
| test_patch_validation                                             | 6     | Adapted | The actions validate with zod and the shared text rules (`scheduleCallAction`, `changeStatusAction`, `saveNoteAction`); the rules are covered by unit/intake-legacy and unit/intake-rules. |
| test_only_appointments_can_be_scheduled                           | 1     | Ported  | integration/inbox › schedules calls only, and can clear the time of anything                                                                                                               |
| test_patch_unknown_request                                        | 1     | Ported  | integration/inbox › records status changes (unknown id gives null)                                                                                                                         |
| test_patch_notifies_client                                        | 1     | Ported  | unit/notify-templates › tell the visitor about a confirmed call                                                                                                                            |
| test_client_email_mentions_the_scheduled_time_only_when_confirmed | 1     | Ported  | unit/notify-templates › mention the scheduled time only when confirming                                                                                                                    |
| test_patch_client_email_for_other_types                           | 1     | Ported  | unit/notify-templates › name other kinds in the status email                                                                                                                               |
| test_patch_client_notification_without_smtp_or_on_failure         | 1     | Adapted | Without email the reply form says so and the actions refuse before changing anything; failures retry in the outbox (integration/outbox).                                                   |
| test_unresponsive_smtp_does_not_hold_up_the_admin                 | 1     | Adapted | Emails to visitors are queued, never sent while the admin waits (integration/outbox; e2e/admin-inbox › open a message, reply).                                                             |
| test_delete                                                       | 1     | Ported  | integration/inbox › deletes a message once; e2e/admin-inbox › delete a message for good                                                                                                    |

## Errors, CORS and the single-server frontend (16)

| v1 test                                                  | Cases | Status         | Now                                                                                                               |
| -------------------------------------------------------- | ----- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| test_database_errors_do_not_leak_details                 | 1     | Ported         | unit/api-errors › say the database is unavailable without its details                                             |
| test_unexpected_errors_return_generic_json               | 1     | Ported         | unit/api-errors › answer anything unexpected with a generic message                                               |
| test_cors                                                | 1     | Adapted        | No cross-origin API: posts from another site are refused (integration/requests-route › refuses cross-site posts). |
| test_spa_routes_serve_index                              | 6     | Not applicable | Next.js renders every page itself; e2e/public checks each page.                                                   |
| test_real_files_are_served                               | 1     | Not applicable | Next.js serves its own assets (e2e/public › machine-readable files).                                              |
| test_frontend_types_do_not_depend_on_the_system_registry | 1     | Not applicable | Next.js sets content types itself, not from the Windows registry.                                                 |
| test_unknown_api_paths_stay_json                         | 4     | Ported         | unit/api-errors › answer unknown API addresses with JSON                                                          |
| test_path_traversal_is_not_served                        | 1     | Ported         | e2e/public › machine-readable files                                                                               |

## Configuration and tooling (4)

| v1 test                                 | Cases | Status   | Now                                                                                                        |
| --------------------------------------- | ----- | -------- | ---------------------------------------------------------------------------------------------------------- |
| test_load_settings                      | 1     | Ported   | unit/env › reads the v1 notification settings under the same names; › explains wrong notification settings |
| test_settings_repr_hides_secrets        | 1     | Ported   | unit/env (no message repeats a secret, MONGO_URL and DISCORD_WEBHOOK_URL included)                         |
| test_hash_password_cli                  | 1     | Replaced | `npm run admin -- create` (scripts/admin.ts)                                                               |
| test_hash_password_cli_rejects_mismatch | 1     | Replaced | scripts/admin.ts asks twice and refuses a mismatch                                                         |

## Totals

| Status                               | Cases   |
| ------------------------------------ | ------- |
| Ported                               | 112     |
| Adapted                              | 20      |
| Replaced                             | 19      |
| Not applicable                       | 9       |
| **All v1 cases (79 test functions)** | **160** |
