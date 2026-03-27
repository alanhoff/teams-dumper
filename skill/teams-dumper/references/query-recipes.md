# Query Recipes

## Table of Contents

- Orientation
- Private messages with real names
- Thread messages from a Teams deep link
- Calendar events with inviter
- Cached transcript list

## Orientation

Use this first when the dump root is unknown or you want to verify the files exist.

```bash
find /search/root -type f \
  \( -name messages.jsonl -o -name people.jsonl -o -name chat_thread.jsonl \
     -o -name reply_chains.jsonl -o -name calendar.jsonl -o -name transcription.jsonl \) \
  | sort
```

Probe one file shape:

```sql
SELECT json_group_structure(json)
FROM read_json_objects('/path/to/export/messages.jsonl');
```

## Private messages with real names

Goal: list your sent 1:1 messages and resolve the other participant to a real name and email.

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

## Thread messages from a Teams deep link

Goal: take a link like `/l/message/<conversationId>/<messageId>` and list the root plus replies.

Use the `conversationId` and the trailing message id from the link. If the link also contains `parentMessageId`, use that as the root reply chain candidate.

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

## Calendar events with inviter

Goal: list the next week of events and show organizer name and email.

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

Replace the date window with the user-requested week. Keep the timezone explicit.

## Cached transcript list

Goal: list transcript-like cache entries, then recover a calendar subject using the `iCalUid` embedded in the source message body.

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

Interpretation rule:

- if `parseError` is present for every row, report that the cache contains transcript references, not parsed transcript text

