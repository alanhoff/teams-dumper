export const OUTPUT_FILES = Object.freeze({
  replyChains: "reply_chains.jsonl",
  chatThreads: "chat_thread.jsonl",
  messages: "messages.jsonl",
  calendar: "calendar.jsonl",
  people: "people.jsonl",
  transcription: "transcription.jsonl"
});

export const DB_PREFIXES = Object.freeze({
  replyChain: "Teams:replychain-manager:react-web-client:",
  conversation: "Teams:conversation-manager:react-web-client:",
  calendar: "Teams:calendar:react-web-client:",
  contacts: "Teams:capiv3-contacts-manager:react-web-client:",
  profiles: "Teams:profiles:react-web-client:"
});

export const STORE_NAMES = Object.freeze({
  replyChain: "replychains",
  conversation: "conversations",
  calendar: "calendar",
  contacts: "capiv3-contacts",
  profiles: "profiles"
});

const STRUCTURED_STRING_RE = /^[\[{]/;

export function buildConversationCanonicalId(dbName, conversationId) {
  return `${dbName}::conversation::${conversationId}`;
}

export function buildReplyChainCanonicalId(dbName, conversationId, replyChainId) {
  return `${dbName}::replychain::${conversationId}::${replyChainId}`;
}

export function buildMessageCanonicalId(dbName, conversationId, messageId, messageVersion = "") {
  return `${dbName}::message::${conversationId}::${messageId}::${messageVersion ?? ""}`;
}

export function buildCalendarCanonicalId(dbName, objectId) {
  return `${dbName}::calendar::${objectId}`;
}

export function canonicalPersonIdFromIdentity(identityType, identityValue) {
  return `person:${identityType}:${identityValue}`;
}

function coerceString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function maybeNumber(value) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function compareMaybeNumeric(left, right) {
  const numericLeft = maybeNumber(left);
  const numericRight = maybeNumber(right);

  if (numericLeft !== null && numericRight !== null) {
    return numericLeft - numericRight;
  }

  return String(left ?? "").localeCompare(String(right ?? ""));
}

function cloneSource(storageKey, dbName, storeName) {
  return {
    dbName,
    storeName,
    storageKey
  };
}

export function parseStructuredString(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || !STRUCTURED_STRING_RE.test(trimmed)) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function normalizeStructuredObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, parseStructuredString(value)])
  );
}

function collectMessageSortKey(message) {
  return (
    maybeNumber(message.originalArrivalTime) ??
    maybeNumber(message.clientArrivalTime) ??
    maybeNumber(message.composeTime) ??
    maybeNumber(message.messageId) ??
    maybeNumber(message.id) ??
    0
  );
}

function identityKey(identityType, identityValue) {
  if (!identityValue) {
    return null;
  }

  return `${identityType}:${identityValue}`;
}

function normalizeEmail(value) {
  const email = coerceString(value);
  return email ? email.toLowerCase() : "";
}

function isHumanProfile(profile) {
  const mri = coerceString(profile?.mri);
  return mri.startsWith("8:") && (profile?.type === "ADUser" || profile?.type === "Federated");
}

function collectContactIdentityKeys(contact) {
  const keys = [];
  const normalizedMri = coerceString(contact?.mri);
  const normalizedObjectId = coerceString(contact?.objectId);
  const normalizedUpn =
    normalizeEmail(contact?.userPrincipalName) ||
    normalizeEmail(contact?.nsp_i_userPrincipalName) ||
    normalizeEmail(contact?.email) ||
    normalizeEmail(contact?.["$$email"]);

  if (normalizedMri) {
    keys.push(identityKey("mri", normalizedMri));
  }
  if (normalizedObjectId) {
    keys.push(identityKey("objectId", normalizedObjectId));
  }
  if (normalizedUpn) {
    keys.push(identityKey("upn", normalizedUpn));
    keys.push(identityKey("email", normalizedUpn));
  }

  for (const alternateId of contact?.alternateIds ?? []) {
    const normalizedAlternateId = coerceString(alternateId);
    if (normalizedAlternateId) {
      keys.push(identityKey("alternateId", normalizedAlternateId));
    }
  }

  for (const emailRecord of contact?.emails ?? []) {
    const normalizedAddress = normalizeEmail(emailRecord?.address);
    if (normalizedAddress) {
      keys.push(identityKey("email", normalizedAddress));
    }
  }

  return [...new Set(keys.filter(Boolean))];
}

function collectProfileIdentityKeys(profile) {
  if (!isHumanProfile(profile)) {
    return [];
  }

  const keys = [];
  const normalizedMri = coerceString(profile?.mri);
  const normalizedObjectId = coerceString(profile?.objectId);
  const normalizedUpn =
    normalizeEmail(profile?.userPrincipalName) ||
    normalizeEmail(profile?.nsp_i_userPrincipalName) ||
    normalizeEmail(profile?.email) ||
    normalizeEmail(profile?.["$$email"]);

  if (normalizedMri) {
    keys.push(identityKey("mri", normalizedMri));
  }
  if (normalizedObjectId) {
    keys.push(identityKey("objectId", normalizedObjectId));
  }
  if (normalizedUpn) {
    keys.push(identityKey("upn", normalizedUpn));
    keys.push(identityKey("email", normalizedUpn));
  }

  return [...new Set(keys.filter(Boolean))];
}

function preferredPersonIdentity(record, sourceType, sourceKey) {
  const mri = coerceString(record?.mri);
  if (mri) {
    return canonicalPersonIdFromIdentity("mri", mri);
  }

  const objectId = coerceString(record?.objectId);
  if (objectId) {
    return canonicalPersonIdFromIdentity("objectId", objectId);
  }

  const email =
    normalizeEmail(record?.userPrincipalName) ||
    normalizeEmail(record?.email) ||
    normalizeEmail(record?.["$$email"]) ||
    normalizeEmail(record?.emails?.[0]?.address);

  if (email) {
    return canonicalPersonIdFromIdentity("email", email);
  }

  return canonicalPersonIdFromIdentity(sourceType, sourceKey);
}

function preferredPersonIdentityFromAccumulator(accumulator) {
  const preferredMri = [...accumulator.identities.mri].sort()[0];
  if (preferredMri) {
    return canonicalPersonIdFromIdentity("mri", preferredMri);
  }

  const preferredObjectId = [...accumulator.identities.objectId].sort()[0];
  if (preferredObjectId) {
    return canonicalPersonIdFromIdentity("objectId", preferredObjectId);
  }

  const preferredEmail =
    [...accumulator.identities.userPrincipalName].sort()[0] ??
    [...accumulator.identities.emails].sort()[0];
  if (preferredEmail) {
    return canonicalPersonIdFromIdentity("email", preferredEmail);
  }

  return accumulator.id;
}

function createPersonAccumulator(id) {
  return {
    id,
    identities: {
      mri: new Set(),
      objectId: new Set(),
      userPrincipalName: new Set(),
      emails: new Set(),
      alternateIds: new Set()
    },
    displayName: null,
    givenName: null,
    surname: null,
    jobTitle: null,
    companyName: null,
    tenantName: null,
    userType: null,
    sourceRefs: [],
    rawSources: {
      contacts: [],
      profiles: []
    }
  };
}

function setIfMissing(target, fieldName, value) {
  if (target[fieldName] === null || target[fieldName] === undefined || target[fieldName] === "") {
    const normalizedValue = typeof value === "string" ? value.trim() : value;
    if (normalizedValue) {
      target[fieldName] = normalizedValue;
    }
  }
}

function addSourceRecord(accumulator, sourceType, sourceRecord) {
  accumulator.sourceRefs.push({
    sourceType,
    source: cloneSource(sourceRecord.storageKey, sourceRecord.dbName, sourceRecord.storeName)
  });

  if (sourceType === "contact") {
    accumulator.rawSources.contacts.push(sourceRecord.value);
  } else if (sourceType === "profile") {
    accumulator.rawSources.profiles.push(sourceRecord.value);
  }

  const record = sourceRecord.value;

  const mri = coerceString(record?.mri);
  if (mri) {
    accumulator.identities.mri.add(mri);
  }

  const objectId = coerceString(record?.objectId);
  if (objectId) {
    accumulator.identities.objectId.add(objectId);
  }

  const upn =
    normalizeEmail(record?.userPrincipalName) ||
    normalizeEmail(record?.nsp_i_userPrincipalName);
  if (upn) {
    accumulator.identities.userPrincipalName.add(upn);
  }

  const directEmail =
    normalizeEmail(record?.email) ||
    normalizeEmail(record?.["$$email"]);
  if (directEmail) {
    accumulator.identities.emails.add(directEmail);
  }

  for (const emailRecord of record?.emails ?? []) {
    const emailAddress = normalizeEmail(emailRecord?.address);
    if (emailAddress) {
      accumulator.identities.emails.add(emailAddress);
    }
  }

  for (const alternateId of record?.alternateIds ?? []) {
    const normalizedAlternateId = coerceString(alternateId);
    if (normalizedAlternateId) {
      accumulator.identities.alternateIds.add(normalizedAlternateId);
    }
  }

  if (sourceType === "profile") {
    setIfMissing(accumulator, "displayName", record.displayName);
    setIfMissing(accumulator, "givenName", record.givenName);
    setIfMissing(accumulator, "surname", record.surname);
    setIfMissing(accumulator, "jobTitle", record.jobTitle);
    setIfMissing(accumulator, "companyName", record.companyName);
    setIfMissing(accumulator, "tenantName", record.tenantName);
    setIfMissing(accumulator, "userType", record.userType || record.type);
  } else {
    setIfMissing(accumulator, "displayName", record?.name?.displayName);
    setIfMissing(accumulator, "givenName", record?.name?.first);
    setIfMissing(accumulator, "surname", record?.name?.last);
    setIfMissing(accumulator, "userType", "Contact");
  }
}

function mergePersonAccumulators(target, source) {
  for (const key of Object.keys(target.identities)) {
    for (const value of source.identities[key]) {
      target.identities[key].add(value);
    }
  }

  for (const sourceRef of source.sourceRefs) {
    target.sourceRefs.push(sourceRef);
  }

  target.rawSources.contacts.push(...source.rawSources.contacts);
  target.rawSources.profiles.push(...source.rawSources.profiles);

  for (const fieldName of ["displayName", "givenName", "surname", "jobTitle", "companyName", "tenantName", "userType"]) {
    setIfMissing(target, fieldName, source[fieldName]);
  }
}

export function normalizePeopleRecords({ contacts = [], profiles = [] }) {
  const peopleById = new Map();
  const identityToPersonId = new Map();

  const sourceRecords = [
    ...contacts.map((record) => ({
      sourceType: "contact",
      sourceKey: `${record.dbName}:${JSON.stringify(record.storageKey)}`,
      record,
      identityKeys: collectContactIdentityKeys(record.value)
    })),
    ...profiles
      .filter((record) => isHumanProfile(record.value))
      .map((record) => ({
        sourceType: "profile",
        sourceKey: `${record.dbName}:${JSON.stringify(record.storageKey)}`,
        record,
        identityKeys: collectProfileIdentityKeys(record.value)
      }))
  ];

  for (const sourceRecord of sourceRecords) {
    const existingPersonIds = [...new Set(sourceRecord.identityKeys.map((key) => identityToPersonId.get(key)).filter(Boolean))];
    const personId =
      existingPersonIds[0] ??
      preferredPersonIdentity(sourceRecord.record.value, sourceRecord.sourceType, sourceRecord.sourceKey);

    let accumulator = peopleById.get(personId);
    if (!accumulator) {
      accumulator = createPersonAccumulator(personId);
      peopleById.set(personId, accumulator);
    }

    for (const additionalPersonId of existingPersonIds.slice(1)) {
      const duplicateAccumulator = peopleById.get(additionalPersonId);
      if (!duplicateAccumulator || duplicateAccumulator === accumulator) {
        continue;
      }

      mergePersonAccumulators(accumulator, duplicateAccumulator);
      peopleById.delete(additionalPersonId);

      for (const identityKeyValue of identityToPersonId.keys()) {
        if (identityToPersonId.get(identityKeyValue) === additionalPersonId) {
          identityToPersonId.set(identityKeyValue, personId);
        }
      }
    }

    addSourceRecord(accumulator, sourceRecord.sourceType, sourceRecord.record);

    for (const key of sourceRecord.identityKeys) {
      identityToPersonId.set(key, personId);
    }
  }

  const people = [...peopleById.values()]
    .map((person) => {
      const finalId = preferredPersonIdentityFromAccumulator(person);
      return {
        id: finalId,
        displayName: person.displayName,
        givenName: person.givenName,
        surname: person.surname,
        jobTitle: person.jobTitle,
        companyName: person.companyName,
        tenantName: person.tenantName,
        userType: person.userType,
        identities: {
          mri: [...person.identities.mri].sort(),
          objectId: [...person.identities.objectId].sort(),
          userPrincipalName: [...person.identities.userPrincipalName].sort(),
          emails: [...person.identities.emails].sort(),
          alternateIds: [...person.identities.alternateIds].sort()
        },
        sourceRefs: person.sourceRefs,
        rawSources: person.rawSources
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const personIdentityIndex = new Map();
  for (const person of people) {
    for (const mri of person.identities.mri) {
      personIdentityIndex.set(identityKey("mri", mri), person.id);
    }
    for (const objectId of person.identities.objectId) {
      personIdentityIndex.set(identityKey("objectId", objectId), person.id);
    }
    for (const upn of person.identities.userPrincipalName) {
      personIdentityIndex.set(identityKey("upn", upn), person.id);
    }
    for (const email of person.identities.emails) {
      personIdentityIndex.set(identityKey("email", email), person.id);
    }
    for (const alternateId of person.identities.alternateIds) {
      personIdentityIndex.set(identityKey("alternateId", alternateId), person.id);
    }
  }

  return { people, personIdentityIndex };
}

export function resolvePersonRef(candidates, personIdentityIndex) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const [identityType, rawValue] = candidate;
    let normalizedValue = rawValue;
    if (identityType === "email" || identityType === "upn") {
      normalizedValue = normalizeEmail(rawValue);
    } else {
      normalizedValue = coerceString(rawValue);
    }

    if (!normalizedValue) {
      continue;
    }

    const resolvedId = personIdentityIndex.get(identityKey(identityType, normalizedValue));
    if (resolvedId) {
      return resolvedId;
    }
  }

  return null;
}

function updateMessageRefLookup(messageRefLookup, dbName, conversationId, messageId, messageVersion, canonicalId) {
  const exactKey = `${dbName}::${conversationId}::${messageId}::${messageVersion ?? ""}`;
  messageRefLookup.byExact.set(exactKey, canonicalId);

  const inexactKey = `${dbName}::${conversationId}::${messageId}`;
  const existing = messageRefLookup.byMessageId.get(inexactKey);
  if (!existing || compareMaybeNumeric(existing.messageVersion, messageVersion) <= 0) {
    messageRefLookup.byMessageId.set(inexactKey, {
      canonicalId,
      messageVersion
    });
  }
}

export function normalizeReplyChainsAndMessages({
  replyChainRecords,
  conversationRefIndex,
  personIdentityIndex
}) {
  const replyChains = [];
  const messages = [];
  const messageRefLookup = {
    byExact: new Map(),
    byMessageId: new Map()
  };

  for (const replyChainRecord of replyChainRecords) {
    const chain = replyChainRecord.value;
    const replyChainId = buildReplyChainCanonicalId(
      replyChainRecord.dbName,
      chain.conversationId,
      chain.replyChainId
    );

    const conversationRef =
      conversationRefIndex.get(`${replyChainRecord.dbName}::${chain.conversationId}`) ?? null;

    const messageEntries = Object.entries(chain.messageMap ?? {})
      .map(([dedupeKey, message]) => ({ dedupeKey, message }))
      .sort((left, right) => collectMessageSortKey(left.message) - collectMessageSortKey(right.message));

    const messageRefs = [];

    for (const { dedupeKey, message } of messageEntries) {
      const {
        id: rawMessageId,
        version: rawMessageVersion,
        properties,
        ...restMessage
      } = message;

      const messageCanonicalId = buildMessageCanonicalId(
        replyChainRecord.dbName,
        chain.conversationId,
        rawMessageId,
        rawMessageVersion
      );

      const creatorRef = resolvePersonRef(
        [
          ["mri", message.creator],
          ["mri", message.fromUserId],
          ["email", message.userPrincipalName]
        ],
        personIdentityIndex
      );

      messages.push({
        id: messageCanonicalId,
        source: cloneSource(replyChainRecord.storageKey, replyChainRecord.dbName, replyChainRecord.storeName),
        conversationRef,
        replyChainRef: replyChainId,
        conversationId: chain.conversationId,
        replyChainId: chain.replyChainId,
        messageId: rawMessageId,
        messageVersion: rawMessageVersion,
        dedupeKey,
        ...restMessage,
        properties: normalizeStructuredObject(properties ?? {}),
        creatorRef
      });

      updateMessageRefLookup(
        messageRefLookup,
        replyChainRecord.dbName,
        chain.conversationId,
        rawMessageId,
        rawMessageVersion,
        messageCanonicalId
      );

      messageRefs.push({
        id: messageCanonicalId,
        messageId: rawMessageId,
        messageVersion: rawMessageVersion,
        dedupeKey
      });
    }

    const {
      messageMap,
      replyChainId: rawReplyChainId,
      ...restChain
    } = chain;

    replyChains.push({
      id: replyChainId,
      source: cloneSource(replyChainRecord.storageKey, replyChainRecord.dbName, replyChainRecord.storeName),
      conversationRef,
      replyChainId: rawReplyChainId,
      ...restChain,
      messageRefs
    });
  }

  messages.sort((left, right) => {
    if (left.conversationId !== right.conversationId) {
      return left.conversationId.localeCompare(right.conversationId);
    }

    const sortDelta = collectMessageSortKey(left) - collectMessageSortKey(right);
    if (sortDelta !== 0) {
      return sortDelta;
    }

    return left.id.localeCompare(right.id);
  });

  replyChains.sort((left, right) => {
    if (left.conversationId !== right.conversationId) {
      return left.conversationId.localeCompare(right.conversationId);
    }
    return compareMaybeNumeric(left.latestDeliveryTime, right.latestDeliveryTime);
  });

  return { messages, replyChains, messageRefLookup };
}

export function normalizeChatThreads({
  conversationRecords,
  messageRefLookup,
  personIdentityIndex
}) {
  return conversationRecords
    .map((conversationRecord) => {
      const conversation = conversationRecord.value;
      const {
        id: rawConversationId,
        lastMessage,
        properties,
        threadProperties,
        ...restConversation
      } = conversation;

      const conversationId = buildConversationCanonicalId(conversationRecord.dbName, rawConversationId);
      const lastMessageExactKey = lastMessage
        ? `${conversationRecord.dbName}::${rawConversationId}::${lastMessage.id}::${lastMessage.version ?? ""}`
        : null;
      const lastMessageInexactKey = lastMessage
        ? `${conversationRecord.dbName}::${rawConversationId}::${lastMessage.id}`
        : null;

      const lastMessageRef =
        (lastMessageExactKey ? messageRefLookup.byExact.get(lastMessageExactKey) : null) ??
        (lastMessageInexactKey ? messageRefLookup.byMessageId.get(lastMessageInexactKey)?.canonicalId : null) ??
        null;

      const creatorRef = resolvePersonRef(
        [
          ["mri", threadProperties?.creator],
          ["mri", lastMessage?.fromUserId],
          ["email", lastMessage?.userPrincipalName]
        ],
        personIdentityIndex
      );

      return {
        id: conversationId,
        source: cloneSource(
          conversationRecord.storageKey,
          conversationRecord.dbName,
          conversationRecord.storeName
        ),
        conversationId: rawConversationId,
        ...restConversation,
        properties: normalizeStructuredObject(properties ?? {}),
        threadProperties: normalizeStructuredObject(threadProperties ?? {}),
        lastMessageRef,
        lastMessageLookup: lastMessage
          ? {
              messageId: lastMessage.id,
              messageVersion: lastMessage.version ?? null
            }
          : null,
        creatorRef
      };
    })
    .sort((left, right) => left.conversationId.localeCompare(right.conversationId));
}

export function normalizeCalendarItems({ calendarRecords, personIdentityIndex }) {
  return calendarRecords
    .map((calendarRecord) => {
      const item = calendarRecord.value;
      return {
        id: buildCalendarCanonicalId(calendarRecord.dbName, item.objectId),
        source: cloneSource(calendarRecord.storageKey, calendarRecord.dbName, calendarRecord.storeName),
        organizerRef: resolvePersonRef([["email", item.organizerAddress]], personIdentityIndex),
        ...item
      };
    })
    .sort((left, right) => {
      const leftStart = maybeNumber(Date.parse(left.startTime)) ?? maybeNumber(left.startTime) ?? 0;
      const rightStart = maybeNumber(Date.parse(right.startTime)) ?? maybeNumber(right.startTime) ?? 0;
      return leftStart - rightStart;
    });
}

export function normalizeTranscriptions({ messages, personIdentityIndex }) {
  return messages
    .filter((message) => message.messageType === "RichText/Media_CallTranscript")
    .map((message) => {
      const parsedContent = parseStructuredString(message.content);
      const normalizedContent = parsedContent && typeof parsedContent === "object" ? parsedContent : null;

      return {
        id: message.id,
        source: {
          derivedFrom: "messages.jsonl",
          messageRef: message.id
        },
        messageRef: message.id,
        conversationRef: message.conversationRef,
        replyChainRef: message.replyChainRef,
        conversationId: message.conversationId,
        replyChainId: message.replyChainId,
        callId: normalizedContent?.callId ?? null,
        scopeId: normalizedContent?.scopeId ?? null,
        storageId: normalizedContent?.storageId ?? null,
        iCalUid: normalizedContent?.iCalUid ?? null,
        exchangeId: normalizedContent?.exchangeId ?? null,
        meetingTenantId: normalizedContent?.meetingTenantId ?? null,
        modernGroupId: normalizedContent?.modernGroupId ?? null,
        meetingOrganizerId: normalizedContent?.meetingOrganizerId ?? null,
        meetingOrganizerRef: resolvePersonRef(
          [["mri", normalizedContent?.meetingOrganizerId]],
          personIdentityIndex
        ),
        originatorParticipantId: normalizedContent?.originatorParticipantId ?? null,
        isDeleted: normalizedContent?.isDeleted ?? null,
        isExportedToOdsp: normalizedContent?.isExportedToOdsp ?? null,
        parseError: normalizedContent ? null : "Unable to parse transcript message content as JSON"
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}
