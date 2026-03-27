# teams-dumper

`teams-dumper` connects to an already-open Chromium-based browser through the Chrome DevTools Protocol (CDP), reads the local Microsoft Teams web caches from IndexedDB, normalizes the records, and writes six idempotent JSONL collections that are easy to inspect with DuckDB.

The main entrypoint is the GitHub repository itself, so the typical usage is:

```bash
npx -y github:alanhoff/teams-dumper --help
```

`-y` skips the `npx` install prompt. The command above was verified against this repository and prints the CLI help.

## What It Exports

Each run writes these files:

- `messages.jsonl`: full message payloads
- `people.jsonl`: people dimension with MRIs, emails, and names
- `chat_thread.jsonl`: per-conversation metadata
- `reply_chains.jsonl`: thread roots and message references
- `calendar.jsonl`: cached calendar events
- `transcription.jsonl`: transcript cache references

The files are rewritten atomically on each run. The exporter keeps the full message payload only in `messages.jsonl`; the other collections reference or summarize related entities.

## Included Skill

This repository also ships a reusable Codex skill under `skill/teams-dumper`. The skill teaches an agent how to inspect these dump files with DuckDB, what each collection contains, and how to answer common questions such as:

- private messages joined to real names
- thread extraction from a Teams deep link
- upcoming calendar events with inviter details
- transcript cache discovery

Install the skill package directly from GitHub:

```bash
npx -y skills@latest add https://github.com/alanhoff/teams-dumper
```

List the skills exposed by the repository before installing:

```bash
npx -y skills@latest add https://github.com/alanhoff/teams-dumper --list
```

## Requirements

- Node.js `>= 22`
- `npm` / `npx`
- A Chromium-based browser with remote debugging enabled
- A logged-in Teams web tab open at `https://teams.microsoft.com/v2/`

Important:

- Use the Teams web app in a browser, not the native desktop shell.
- Keep the remote-debugging port bound to `127.0.0.1`.
- Prefer a dedicated `--user-data-dir` so you do not expose your main browser profile to CDP.

## Quick Start

1. Start Chrome, Chromium, or Edge with remote debugging enabled.
2. Sign in to Teams in that browser and keep the `https://teams.microsoft.com/v2/` tab open.
3. Run the dumper:

```bash
npx -y github:alanhoff/teams-dumper --out-dir ./dump --verbose
```

If everything works, the command prints a JSON summary like this:

```json
{
  "app": {
    "title": "Microsoft Teams",
    "url": "https://teams.microsoft.com/v2/"
  },
  "counts": {
    "replyChains": 0,
    "chatThreads": 0,
    "messages": 0,
    "calendar": 0,
    "people": 0,
    "transcription": 0
  },
  "outputPaths": {
    "replyChains": "/absolute/path/to/dump/reply_chains.jsonl",
    "chatThreads": "/absolute/path/to/dump/chat_thread.jsonl",
    "messages": "/absolute/path/to/dump/messages.jsonl",
    "calendar": "/absolute/path/to/dump/calendar.jsonl",
    "people": "/absolute/path/to/dump/people.jsonl",
    "transcription": "/absolute/path/to/dump/transcription.jsonl"
  }
}
```

## CLI

```text
Usage: teams-dumper [options]

Options:
  --cdp-url <url>   CDP endpoint to connect to (default: http://127.0.0.1:9222)
  --out-dir <dir>   Output directory for the exported files (default: current directory)
  --verbose         Print progress to stderr
  --help, -h        Show this help text
```

### Examples

Show help:

```bash
npx -y github:alanhoff/teams-dumper --help
```

Export into the current directory:

```bash
npx -y github:alanhoff/teams-dumper
```

Export into `./dump` and print progress:

```bash
npx -y github:alanhoff/teams-dumper --out-dir ./dump --verbose
```

Connect to a different CDP port:

```bash
npx -y github:alanhoff/teams-dumper \
  --cdp-url http://127.0.0.1:9333 \
  --out-dir ./dump
```

## Opening Teams With Remote Debugging

Use any Chromium-based browser that Playwright can attach to over CDP.

### macOS

Google Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cache/teams-dumper-chrome" \
  "https://teams.microsoft.com/v2/"
```

Microsoft Edge:

```bash
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cache/teams-dumper-edge" \
  "https://teams.microsoft.com/v2/"
```

### Linux

Google Chrome:

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cache/teams-dumper-chrome" \
  "https://teams.microsoft.com/v2/"
```

Chromium:

```bash
chromium \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cache/teams-dumper-chromium" \
  "https://teams.microsoft.com/v2/"
```

### Windows PowerShell

Google Chrome:

```powershell
& "$Env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$Env:TEMP\teams-dumper-chrome" `
  "https://teams.microsoft.com/v2/"
```

Microsoft Edge:

```powershell
& "$Env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$Env:TEMP\teams-dumper-edge" `
  "https://teams.microsoft.com/v2/"
```

After the browser starts:

1. Sign in to Teams if needed.
2. Wait for the web app to finish loading.
3. Keep the Teams tab open while the dumper runs.

## How It Works

The CLI:

1. Connects to the CDP endpoint.
2. Finds an open page whose URL starts with `https://teams.microsoft.com/v2/`.
3. Enumerates IndexedDB databases in that page.
4. Reads the Teams object stores for conversations, reply chains, calendar, contacts, and profiles.
5. Normalizes the raw cache into six JSONL collections.
6. Writes the output files atomically into the target directory.

This is a local cache exporter. It does not call Microsoft Graph or require separate API credentials. If a record was never cached in the browser profile you used, it will not appear in the dump.

## Querying The Dump With DuckDB

DuckDB is the easiest way to inspect the exported JSONL files.

### Install DuckDB

macOS with Homebrew:

```bash
brew install duckdb
```

Other platforms:

- Install the DuckDB CLI from the official docs: `https://duckdb.org/docs/stable/installation/`
- Verify it works:

```bash
duckdb --version
```

### Important Rule: Use `read_json_objects(...)`

Always read these files with `read_json_objects(...)`, especially `messages.jsonl`.

Do not start with `read_json_auto(...)` on the large files. `messages.jsonl` can contain repeated nested keys that break typed auto-inference.

Good:

```sql
SELECT json_extract_string(json, '$.messageId')
FROM read_json_objects('/path/to/export/messages.jsonl');
```

Bad:

```sql
SELECT *
FROM read_json_auto('/path/to/export/messages.jsonl');
```

### Orientation Query

Use this first to confirm you are pointing at the right dump root:

```sql
SELECT 'messages' AS file, count() AS rows
FROM read_json_objects('/path/to/export/messages.jsonl')
UNION ALL
SELECT 'people', count()
FROM read_json_objects('/path/to/export/people.jsonl')
UNION ALL
SELECT 'chat_thread', count()
FROM read_json_objects('/path/to/export/chat_thread.jsonl')
UNION ALL
SELECT 'reply_chains', count()
FROM read_json_objects('/path/to/export/reply_chains.jsonl')
UNION ALL
SELECT 'calendar', count()
FROM read_json_objects('/path/to/export/calendar.jsonl')
UNION ALL
SELECT 'transcription', count()
FROM read_json_objects('/path/to/export/transcription.jsonl');
```

You can also probe the structure of one file:

```sql
SELECT json_group_structure(json)
FROM read_json_objects('/path/to/export/messages.jsonl');
```

### Example: List Private Messages With Real Names

This query finds the current user MRI from sent messages, detects 1:1 conversations from `chat_thread.jsonl`, and joins the counterpart MRI to `people.jsonl`.

```sql
WITH me AS (
  SELECT DISTINCT json_extract_string(json, '$.creator') AS my_mri
  FROM read_json_objects('/path/to/export/messages.jsonl')
  WHERE COALESCE(TRY_CAST(json_extract(json, '$.isSentByCurrentUser') AS BOOLEAN), false)
),
private_conversations AS (
  SELECT
    json_extract_string(ct.json, '$.conversationId') AS conversation_id,
    json_extract_string(member_json, '$.id') AS counterpart_mri
  FROM read_json_objects('/path/to/export/chat_thread.jsonl') ct,
       me,
       UNNEST(from_json(json_extract(ct.json, '$.members'), '["JSON"]')) AS members(member_json)
  WHERE json_extract_string(ct.json, '$.type') = 'Chat'
    AND json_array_length(json_extract(ct.json, '$.members')) = 2
    AND json_extract_string(member_json, '$.id') <> me.my_mri
),
people_ranked AS (
  SELECT
    mri,
    COALESCE(
      NULLIF(trim(json_extract_string(p.json, '$.displayName')), ''),
      NULLIF(trim(concat_ws(' ', json_extract_string(p.json, '$.givenName'), json_extract_string(p.json, '$.surname'))), ''),
      NULLIF(trim(email), ''),
      json_extract_string(p.json, '$.id')
    ) AS person_name,
    NULLIF(trim(email), '') AS person_email,
    row_number() OVER (
      PARTITION BY mri
      ORDER BY
        (json_extract_string(p.json, '$.displayName') IS NOT NULL) DESC,
        length(COALESCE(json_extract_string(p.json, '$.displayName'), email, '')) DESC,
        json_extract_string(p.json, '$.id') ASC,
        email ASC
    ) AS rn
  FROM read_json_objects('/path/to/export/people.jsonl') p,
       UNNEST(COALESCE(from_json(json_extract(p.json, '$.identities.mri'), '["VARCHAR"]'), []::VARCHAR[])) AS m(mri),
       UNNEST(COALESCE(from_json(json_extract(p.json, '$.identities.emails'), '["VARCHAR"]'), []::VARCHAR[])) AS e(email)
)
SELECT
  to_timestamp(TRY_CAST(json_extract_string(m.json, '$.originalArrivalTime') AS BIGINT) / 1000.0) AS sent_at,
  pc.conversation_id,
  pr.person_name AS counterpart_name,
  pr.person_email AS counterpart_email,
  trim(
    regexp_replace(
      regexp_replace(COALESCE(json_extract_string(m.json, '$.content'), ''), '<[^>]+>', ' ', 'g'),
      '\\s+',
      ' ',
      'g'
    )
  ) AS content_text
FROM read_json_objects('/path/to/export/messages.jsonl') m
JOIN private_conversations pc
  ON json_extract_string(m.json, '$.conversationId') = pc.conversation_id
LEFT JOIN people_ranked pr
  ON pc.counterpart_mri = pr.mri AND pr.rn = 1
WHERE COALESCE(TRY_CAST(json_extract(m.json, '$.isSentByCurrentUser') AS BOOLEAN), false)
  AND json_extract_string(m.json, '$.type') = 'Message'
ORDER BY sent_at DESC
LIMIT 50;
```

### Example: List Messages From A Teams Deep Link

Given a link like:

```text
https://teams.microsoft.com/l/message/19:example-thread@thread.tacv2/1770000000000?parentMessageId=1770000000000
```

Use the `conversationId` and the root message id:

```sql
WITH people_ranked AS (
  SELECT
    mri,
    COALESCE(
      NULLIF(trim(json_extract_string(p.json, '$.displayName')), ''),
      NULLIF(trim(concat_ws(' ', json_extract_string(p.json, '$.givenName'), json_extract_string(p.json, '$.surname'))), ''),
      NULLIF(trim(email), ''),
      json_extract_string(p.json, '$.id')
    ) AS person_name,
    NULLIF(trim(email), '') AS person_email,
    row_number() OVER (PARTITION BY mri ORDER BY 1) AS rn
  FROM read_json_objects('/path/to/export/people.jsonl') p,
       UNNEST(COALESCE(from_json(json_extract(p.json, '$.identities.mri'), '["VARCHAR"]'), []::VARCHAR[])) AS m(mri),
       UNNEST(COALESCE(from_json(json_extract(p.json, '$.identities.emails'), '["VARCHAR"]'), []::VARCHAR[])) AS e(email)
),
thread_messages AS (
  SELECT
    json_extract_string(m.json, '$.conversationId') AS conversation_id,
    json_extract_string(m.json, '$.messageId') AS message_id,
    json_extract_string(m.json, '$.replyChainId') AS reply_chain_id,
    json_extract_string(m.json, '$.parentMessageId') AS parent_message_id,
    json_extract_string(m.json, '$.creator') AS creator_mri,
    to_timestamp(TRY_CAST(json_extract_string(m.json, '$.originalArrivalTime') AS BIGINT) / 1000.0) AS sent_at,
    trim(
      regexp_replace(
        regexp_replace(COALESCE(json_extract_string(m.json, '$.content'), ''), '<[^>]+>', ' ', 'g'),
        '\\s+',
        ' ',
        'g'
      )
    ) AS content_text
  FROM read_json_objects('/path/to/export/messages.jsonl') m
  WHERE json_extract_string(m.json, '$.conversationId') = '19:example-thread@thread.tacv2'
    AND (
      json_extract_string(m.json, '$.messageId') = '1770000000000'
      OR json_extract_string(m.json, '$.replyChainId') = '1770000000000'
      OR json_extract_string(m.json, '$.parentMessageId') = '1770000000000'
    )
)
SELECT
  sent_at,
  COALESCE(pr.person_name, tm.creator_mri) AS person_name,
  pr.person_email,
  tm.message_id,
  tm.content_text
FROM thread_messages tm
LEFT JOIN people_ranked pr
  ON tm.creator_mri = pr.mri AND pr.rn = 1
ORDER BY sent_at;
```

### Example: List Next Week's Calendar Events And Inviter

```sql
SELECT
  json_extract_string(json, '$.subject') AS subject,
  TRY_CAST(json_extract_string(json, '$.startTime') AS TIMESTAMPTZ)
    AT TIME ZONE 'America/Sao_Paulo' AS start_local,
  TRY_CAST(json_extract_string(json, '$.endTime') AS TIMESTAMPTZ)
    AT TIME ZONE 'America/Sao_Paulo' AS end_local,
  json_extract_string(json, '$.location') AS location,
  json_extract_string(json, '$.organizerName') AS inviter_name,
  json_extract_string(json, '$.organizerAddress') AS inviter_email,
  json_extract_string(json, '$.myResponseType') AS my_response_type
FROM read_json_objects('/path/to/export/calendar.jsonl')
WHERE TRY_CAST(json_extract_string(json, '$.startTime') AS TIMESTAMPTZ)
        >= TIMESTAMPTZ '2026-03-30 00:00:00 America/Sao_Paulo'
  AND TRY_CAST(json_extract_string(json, '$.startTime') AS TIMESTAMPTZ)
        < TIMESTAMPTZ '2026-04-06 00:00:00 America/Sao_Paulo'
ORDER BY TRY_CAST(json_extract_string(json, '$.startTime') AS TIMESTAMPTZ);
```

Replace the date window with the week you actually want.

### Example: List Cached Transcript Entries

```sql
WITH transcript_msgs AS (
  SELECT
    json_extract_string(t.json, '$.conversationId') AS conversation_id,
    json_extract_string(t.json, '$.replyChainId') AS reply_chain_id,
    json_extract_string(t.json, '$.parseError') AS parse_error,
    to_timestamp(TRY_CAST(json_extract_string(m.json, '$.originalArrivalTime') AS BIGINT) / 1000.0) AS source_message_ts,
    lower(regexp_extract(json_extract_string(m.json, '$.content'), '\\\"iCalUid\\\":\\\"([^\\\"]+)\\\"', 1)) AS i_cal_uid
  FROM read_json_objects('/path/to/export/transcription.jsonl') t
  LEFT JOIN read_json_objects('/path/to/export/messages.jsonl') m
    ON json_extract_string(t.json, '$.messageRef') = json_extract_string(m.json, '$.id')
),
calendar_events AS (
  SELECT DISTINCT
    lower(json_extract_string(json, '$.iCalUID')) AS i_cal_uid,
    json_extract_string(json, '$.subject') AS subject,
    TRY_CAST(json_extract_string(json, '$.startTime') AS TIMESTAMPTZ)
      AT TIME ZONE 'America/Sao_Paulo' AS start_local
  FROM read_json_objects('/path/to/export/calendar.jsonl')
)
SELECT
  tm.conversation_id,
  COALESCE(ce.subject, '(no calendar subject found)') AS subject,
  count() AS transcript_rows,
  min(tm.source_message_ts) AS first_seen,
  max(tm.source_message_ts) AS last_seen,
  min(tm.parse_error) AS parse_error
FROM transcript_msgs tm
LEFT JOIN calendar_events ce ON tm.i_cal_uid = ce.i_cal_uid
GROUP BY ALL
ORDER BY last_seen DESC NULLS LAST, transcript_rows DESC;
```

If `parseError` is populated for every row, the cache contains transcript references, not parsed transcript text.

## Tips And Traps

- Do not hard-code the dump path to `./tmp`. Use the actual export directory.
- Do not join on display text. Join on MRI, email, `messageRef`, or `iCalUID`.
- Do not assume a private chat from message shape alone. Use `chat_thread.type = 'Chat'` and `json_array_length(members) = 2`.
- Do not assume `transcription.jsonl` contains transcript body text.
- Do not strip HTML and then claim the result is lossless. Mentions, links, images, and cards can be lost.
- Do not forget message-version dedupe when the same `messageId` appears more than once.
- Use `TRY_CAST(...)` for booleans and timestamps because cached rows are not perfectly uniform.
- Use `json_group_structure(json)` to orient quickly before writing a long query.
- Use `from_json(..., '["VARCHAR"]')` before `UNNEST(...)` on array fields.
- Normalize `iCalUID` with `lower(...)` before joining.

## Troubleshooting

### `Could not find an open Teams page matching https://teams.microsoft.com/v2/`

The browser is reachable, but there is no matching Teams web page open in that CDP session.

Check:

- You opened the browser with `--remote-debugging-port`
- You are signed in
- The Teams web app is open at `https://teams.microsoft.com/v2/`
- You ran the dumper against the same browser instance you opened

### `No IndexedDB databases matched prefix ...`

The Teams page was found, but the expected local caches were not available yet.

Try:

- wait for the app to finish loading
- reload the Teams tab once
- open the relevant Teams sections so the cache gets populated
- rerun with `--verbose`

### `indexedDB.databases() is not available in the page context`

The attached target does not expose the browser APIs the exporter expects.

Check:

- you are attached to a real Chromium-based browser
- you are not pointing to a non-page target
- the Teams tab is a normal web page, not a special shell view

## Local Development

Install dependencies:

```bash
npm install
```

Run the CLI directly:

```bash
node src/index.mjs --help
```

Run tests:

```bash
npm test
```

## Notes

- This project reads local browser cache data only.
- The completeness of the dump depends on what the browser profile has already cached.
- Some conversation titles, channel names, or transcript bodies may be missing from the local caches even when they are visible in the Teams UI.
