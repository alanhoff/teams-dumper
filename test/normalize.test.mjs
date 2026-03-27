import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationCanonicalId,
  buildMessageCanonicalId,
  normalizeChatThreads,
  normalizePeopleRecords,
  normalizeReplyChainsAndMessages,
  normalizeTranscriptions
} from "../src/normalize.mjs";

test("normalizeReplyChainsAndMessages flattens messages and keeps only refs in reply chains", () => {
  const conversationRefIndex = new Map([
    ["db-reply::19:thread@thread.tacv2", buildConversationCanonicalId("db-reply", "19:thread@thread.tacv2")]
  ]);

  const replyChainRecords = [
    {
      dbName: "db-reply",
      storeName: "replychains",
      storageKey: ["19:thread@thread.tacv2", "100"],
      value: {
        conversationId: "19:thread@thread.tacv2",
        replyChainId: "100",
        latestDeliveryTime: 20,
        messageMap: {
          "mri-1": {
            id: "message-1",
            version: "2",
            creator: "8:orgid:user-1",
            messageType: "RichText/Html",
            content: "<p>Hello</p>",
            properties: {
              mentions: "[]"
            },
            originalArrivalTime: 10
          }
        }
      }
    }
  ];

  const personIdentityIndex = new Map([["mri:8:orgid:user-1", "person:mri:8:orgid:user-1"]]);

  const { messages, replyChains, messageRefLookup } = normalizeReplyChainsAndMessages({
    replyChainRecords,
    conversationRefIndex,
    personIdentityIndex
  });

  assert.equal(messages.length, 1);
  assert.equal(replyChains.length, 1);
  assert.equal(messages[0].id, buildMessageCanonicalId("db-reply", "19:thread@thread.tacv2", "message-1", "2"));
  assert.equal(messages[0].creatorRef, "person:mri:8:orgid:user-1");
  assert.deepEqual(messages[0].properties.mentions, []);
  assert.deepEqual(replyChains[0].messageRefs, [
    {
      id: messages[0].id,
      messageId: "message-1",
      messageVersion: "2",
      dedupeKey: "mri-1"
    }
  ]);
  assert.equal(messageRefLookup.byExact.get("db-reply::19:thread@thread.tacv2::message-1::2"), messages[0].id);
});

test("normalizeChatThreads replaces embedded lastMessage with a pointer", () => {
  const messageCanonicalId = buildMessageCanonicalId("db-conversation", "19:thread@thread.tacv2", "message-1", "2");

  const chatThreads = normalizeChatThreads({
    conversationRecords: [
      {
        dbName: "db-conversation",
        storeName: "conversations",
        storageKey: "19:thread@thread.tacv2",
        value: {
          id: "19:thread@thread.tacv2",
          type: "Topic",
          threadProperties: {
            creator: "8:orgid:user-1",
            "tab::abc": "{\"name\":\"Notes\"}"
          },
          properties: {
            favorite: "false"
          },
          lastMessage: {
            id: "message-1",
            version: "2"
          }
        }
      }
    ],
    messageRefLookup: {
      byExact: new Map([["db-conversation::19:thread@thread.tacv2::message-1::2", messageCanonicalId]]),
      byMessageId: new Map()
    },
    personIdentityIndex: new Map([["mri:8:orgid:user-1", "person:mri:8:orgid:user-1"]])
  });

  assert.equal(chatThreads.length, 1);
  assert.equal(chatThreads[0].lastMessageRef, messageCanonicalId);
  assert.equal(chatThreads[0].creatorRef, "person:mri:8:orgid:user-1");
  assert.deepEqual(chatThreads[0].threadProperties["tab::abc"], { name: "Notes" });
  assert.deepEqual(chatThreads[0].lastMessageLookup, {
    messageId: "message-1",
    messageVersion: "2"
  });
  assert.equal("lastMessage" in chatThreads[0], false);
});

test("normalizePeopleRecords merges contacts and profiles and filters bot profiles", () => {
  const { people, personIdentityIndex } = normalizePeopleRecords({
    contacts: [
      {
        dbName: "db-contact",
        storeName: "capiv3-contacts",
        storageKey: "contact-1",
        value: {
          id: "contact-1",
          name: {
            displayName: "Ada Lovelace",
            first: "Ada",
            last: "Lovelace"
          },
          emails: [{ address: "ada@example.com" }]
        }
      }
    ],
    profiles: [
      {
        dbName: "db-profile",
        storeName: "profiles",
        storageKey: "8:orgid:ada",
        value: {
          type: "ADUser",
          mri: "8:orgid:ada",
          objectId: "user-ada",
          displayName: "Ada Lovelace",
          givenName: "Ada",
          surname: "Lovelace",
          userPrincipalName: "ada@example.com",
          companyName: "Analytical Engine"
        }
      },
      {
        dbName: "db-profile",
        storeName: "profiles",
        storageKey: "28:bot",
        value: {
          type: "BOT",
          mri: "28:bot",
          displayName: "A bot",
          userPrincipalName: "28:bot"
        }
      }
    ]
  });

  assert.equal(people.length, 1);
  assert.equal(people[0].companyName, "Analytical Engine");
  assert.deepEqual(people[0].identities.emails, ["ada@example.com"]);
  assert.equal(personIdentityIndex.get("mri:8:orgid:ada"), people[0].id);
  assert.equal(personIdentityIndex.get("email:ada@example.com"), people[0].id);
});

test("normalizeTranscriptions parses transcript content and only keeps pointers to messages", () => {
  const transcriptMessageId = buildMessageCanonicalId("db-reply", "19:meeting@thread.v2", "transcript-1", "1");
  const transcription = normalizeTranscriptions({
    messages: [
      {
        id: transcriptMessageId,
        conversationRef: "conversation-ref",
        replyChainRef: "replychain-ref",
        conversationId: "19:meeting@thread.v2",
        replyChainId: "200",
        messageType: "RichText/Media_CallTranscript",
        content: JSON.stringify({
          callId: "call-123",
          meetingOrganizerId: "8:orgid:ada",
          storageId: "storage-1"
        })
      }
    ],
    personIdentityIndex: new Map([["mri:8:orgid:ada", "person:mri:8:orgid:ada"]])
  });

  assert.equal(transcription.length, 1);
  assert.equal(transcription[0].messageRef, transcriptMessageId);
  assert.equal(transcription[0].callId, "call-123");
  assert.equal(transcription[0].meetingOrganizerRef, "person:mri:8:orgid:ada");
  assert.equal("content" in transcription[0], false);
});
