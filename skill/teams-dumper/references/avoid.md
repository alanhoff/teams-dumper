# What Not To Do

## Do not hard-code the dump path

Bad:

```sql
FROM read_json_objects('./tmp/messages.jsonl')
```

Good:

```sql
FROM read_json_objects('/path/to/export/messages.jsonl')
```

Locate the export root first and then substitute the real absolute path.

## Do not use read_json_auto on the biggest files by default

`messages.jsonl` can contain repeated nested keys such as duplicate `shareID` fields. That is enough to make typed auto-inference fail or behave inconsistently.

Preferred pattern:

```sql
SELECT json_extract_string(json, '$.messageId')
FROM read_json_objects('/path/to/export/messages.jsonl');
```

## Do not join on display text

Bad joins:

- `imDisplayName = displayName`
- mention preview text
- organizer display strings

Preferred joins:

- sender MRI -> `people.identities.mri`
- email -> `people.identities.emails`
- message refs -> message `id`
- `iCalUid` -> calendar `iCalUID`

## Do not assume a private chat from message shape alone

`threadType`, `imDisplayName`, and conversation id patterns are not enough. For a reliable 1:1 chat filter, use:

- `chat_thread.type = 'Chat'`
- `json_array_length(chat_thread.members) = 2`

## Do not assume transcript cache means transcript text

`transcription.jsonl` often stores references plus parse errors. Check `parseError` before claiming the transcript body is available.

## Do not treat HTML-stripped text as lossless

Stripping tags is useful for summaries, but it can destroy:

- mention boundaries
- embedded links
- inline images
- cards and attachments

Keep both `content_text` and `content_html` when precision matters.

## Do not forget message-version dedupe

When the same `messageId` appears multiple times, prefer the highest `messageVersion`.

Example:

```sql
row_number() over (
  partition by message_id
  order by TRY_CAST(message_version AS BIGINT) DESC NULLS LAST
)
```

## Tips and Tricks

- Use `json_group_structure(json)` to orient quickly before writing a long query.
- Use `from_json(..., '["VARCHAR"]')` before `UNNEST(...)` on array fields.
- Normalize join keys with `lower(...)` when matching `iCalUID`.
- Convert epoch milliseconds with `to_timestamp(ms / 1000.0)`.
- Use `TRY_CAST(...)` on timestamps and booleans because cache rows are not perfectly uniform.
- Use `regexp_extract(...)` when a message body contains an escaped JSON blob rather than structured JSON.
- If a channel or meeting title is missing in `chat_thread.jsonl`, say that the export did not retain it and disclose any external hint you used instead.
