# Dump Files

Use this reference when you need to understand which file should answer a question.

## messages.jsonl

Role: source of truth for message payloads.

High-value fields:

- `conversationId`
- `replyChainId`
- `messageId`
- `parentMessageId`
- `creator`
- `creatorRef`
- `threadType`
- `type`
- `messageType`
- `originalArrivalTime`
- `content`
- `isSentByCurrentUser`
- `properties`

What it is good for:

- listing messages in a chat, channel, meeting, or thread
- filtering to messages sent by the current user
- extracting raw HTML, mentions, cards, image payloads, and embedded metadata
- recovering transcript metadata stored inside message bodies

Important notes:

- Use `read_json_objects(...)`, not `read_json_auto(...)`
- Multiple message versions can exist for the same `messageId`
- `content` is often HTML, not plain text
- Some rows are non-chat system events or recording notices

## people.jsonl

Role: identity index for real names, emails, and MRIs.

High-value fields:

- `id`
- `displayName`
- `givenName`
- `surname`
- `userType`
- `identities.mri`
- `identities.emails`

What it is good for:

- resolving sender MRI to a real person name
- resolving organizer or attendee email to a person row when present
- building a stable people dimension for joins

Important notes:

- `identities.mri` and `identities.emails` are arrays
- one person can produce multiple exploded rows if you unnest both arrays
- rank or deduplicate after exploding

## chat_thread.jsonl

Role: per-conversation metadata.

High-value fields:

- `conversationId`
- `type`
- `members`
- `properties`
- `title`
- `topic`

What it is good for:

- distinguishing `Chat`, `Topic`, `Meeting`, `Space`, and other conversation types
- identifying 1:1 chats by checking `type = 'Chat'` and `json_array_length(members) = 2`
- pulling conversation-level metadata before joining to messages

Important notes:

- `threadType` is often absent here; use `type`
- `title` and `topic` are frequently null even when the UI shows a name
- `members` usually contains the canonical MRI IDs you need for joins

## reply_chains.jsonl

Role: thread-root metadata and message references.

High-value fields:

- `conversationId`
- `replyChainId`
- `latestDeliveryTime`
- `messageRefs`
- `messageSearchKeys`
- `parentMessageVersion`

What it is good for:

- finding all messages attached to a root thread
- validating that a `replyChainId` belongs to a given conversation
- enumerating message refs without rescanning the full message body

Important notes:

- `messageRefs` is an array of `{ id, messageId, messageVersion, dedupeKey }`
- the actual message content still lives in `messages.jsonl`

## calendar.jsonl

Role: cached calendar events.

High-value fields:

- `subject`
- `startTime`
- `endTime`
- `organizerName`
- `organizerAddress`
- `organizerRef`
- `myResponseType`
- `location`
- `attendees`
- `iCalUID`
- `cleanGlobalObjectId`

What it is good for:

- listing upcoming events
- showing inviter or organizer
- joining a cached transcript entry back to a meeting subject

Important notes:

- `startTime` and `endTime` are timestamp strings, usually UTC
- `iCalUID` often needs `lower(...)` normalization before joins
- recurring meetings can appear as multiple event rows with related IDs

## transcription.jsonl

Role: transcript cache references.

High-value fields:

- `conversationId`
- `replyChainId`
- `messageRef`
- `source.derivedFrom`
- `parseError`

What it is good for:

- listing which conversations have transcript-like cache entries
- finding the source message that carried transcript metadata
- bridging from transcript cache to calendar via `iCalUid` embedded in the source message

Important notes:

- this collection may not contain transcript text
- the source message body can be an escaped JSON blob
- expect to use `regexp_extract(...)` against the source message `content`

## Suggested Orientation Query

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
