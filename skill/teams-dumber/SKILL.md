---
name: teams-dumber
description: Inspect Microsoft Teams export dumps with DuckDB, explain what each JSONL collection contains, and answer questions about private chats, thread messages, calendar events, and transcript cache entries using reusable query patterns.
---

# Teams Dumber

Use this skill when a user has a Teams export dump and wants to understand the file layout or query it with DuckDB. It is for analysis of local JSONL dumps such as `messages.jsonl`, `people.jsonl`, `chat_thread.jsonl`, `reply_chains.jsonl`, `calendar.jsonl`, and `transcription.jsonl`.

## Quick Start

1. Locate the dump root. Do not assume the files live under `./tmp`.
2. Verify DuckDB is installed:
   - macOS with Homebrew: `brew install duckdb`
   - Other platforms: install the DuckDB CLI from the official install docs, then verify with `duckdb --version`
   - Docs: `https://duckdb.org/docs/installation`
3. Use `read_json_objects(...)` for every dump file. The JSONL collections are irregular and `messages.jsonl` in particular can break `read_json_auto(...)`.
4. Treat each file as a different index:
   - `messages.jsonl`: source of truth for message payloads
   - `people.jsonl`: real names, emails, and MRIs
   - `chat_thread.jsonl`: conversation metadata and membership
   - `reply_chains.jsonl`: thread roots and message references
   - `calendar.jsonl`: event cache
   - `transcription.jsonl`: transcript cache references, usually not transcript text

## Workflow

### 1. Orient to the dump

Start with row counts and a quick schema check. Use [references/dump-files.md](references/dump-files.md) when you need the field map for a collection.

### 2. Pick the primary collection

Route the question to the smallest useful set of files:

- Identity lookup: `people.jsonl`
- Private 1:1 messages: `chat_thread.jsonl` + `messages.jsonl` + `people.jsonl`
- Thread or channel replies: `messages.jsonl` and often `reply_chains.jsonl`, then join to `people.jsonl`
- Calendar questions: `calendar.jsonl`
- Transcript cache questions: `transcription.jsonl`, then join back to `messages.jsonl`, and sometimes to `calendar.jsonl`

### 3. Extract fields manually

`read_json_objects(...)` returns one `json` column. Pull fields with `json_extract_string(...)`, `TRY_CAST(...)`, `regexp_extract(...)`, and `from_json(...)`.

### 4. Join on canonical IDs

Prefer stable IDs over display text:

- Person join key: MRI from `people.identities.mri`
- Message join keys: `conversationId`, `replyChainId`, `messageId`, `messageRef`
- Calendar join key: normalize `iCalUID` with `lower(...)`

### 5. Clean the output

- Deduplicate message versions with `row_number() over (partition by messageId order by messageVersion desc)`
- Convert epoch milliseconds with `to_timestamp(ms / 1000.0)`
- Strip HTML with `regexp_replace(...)`
- Keep raw HTML when the user may care about mentions, images, or links

## Query Packs

Read [references/query-recipes.md](references/query-recipes.md) for concrete DuckDB queries covering:

- Row counts and schema probes
- Private-message lookup with real-name join
- Thread extraction from a Teams deep link
- Upcoming calendar events with inviter
- Cached transcript listing with calendar subject recovery

Read [references/avoid.md](references/avoid.md) before writing a new query or when a result looks wrong.

## Guardrails

- Do not assume `threadType = 'chat'` means a private 1:1 chat. Use `chat_thread.jsonl` and confirm `type = 'Chat'` with exactly two `members`.
- Do not trust `imDisplayName` or mention text as the real identity. Join the sender MRI to `people.jsonl`.
- Do not assume `transcription.jsonl` contains transcript body text. It often stores only references plus parse errors.
- Do not assume channel names are stored cleanly in the dump. If the export does not keep the title, say so and state whether you inferred it from a URL or another source.
- Do not switch to `read_json_auto(...)` just because it works on smaller files. Stay with `read_json_objects(...)` unless the user explicitly needs typed auto-inference and the file is known to be safe.
