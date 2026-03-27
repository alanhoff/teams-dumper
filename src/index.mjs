#!/usr/bin/env node

import { mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";
import { listIndexedDbNames, readObjectStoreRecords, selectMatchingDatabaseNames } from "./indexeddb.mjs";
import {
  DB_PREFIXES,
  OUTPUT_FILES,
  STORE_NAMES,
  buildConversationCanonicalId,
  normalizeCalendarItems,
  normalizeChatThreads,
  normalizePeopleRecords,
  normalizeReplyChainsAndMessages,
  normalizeTranscriptions
} from "./normalize.mjs";

function parseArgs(argv) {
  const options = {
    cdpUrl: "http://127.0.0.1:9222",
    outDir: process.cwd(),
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--cdp-url") {
      options.cdpUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--out-dir") {
      options.outDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      console.log(`Usage: teams-dumper [options]

Options:
  --cdp-url <url>   CDP endpoint to connect to (default: http://127.0.0.1:9222)
  --out-dir <dir>   Output directory for the exported files (default: current directory)
  --verbose         Print progress to stderr
  --help, -h        Show this help text
`);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function createLogger(verbose) {
  return {
    info(message) {
      if (verbose) {
        console.error(message);
      }
    }
  };
}

async function findTeamsPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().startsWith("https://teams.microsoft.com/v2/")) {
        return page;
      }
    }
  }

  throw new Error("Could not find an open Teams page matching https://teams.microsoft.com/v2/");
}

async function collectMatchingStoreRecords({
  page,
  databaseNames,
  prefix,
  storeName,
  required,
  logger
}) {
  const matchedDatabases = selectMatchingDatabaseNames(databaseNames, prefix);
  if (matchedDatabases.length === 0) {
    if (required) {
      throw new Error(`No IndexedDB databases matched prefix ${prefix}`);
    }
    logger.info(`No databases matched optional prefix ${prefix}; exporting an empty collection`);
    return [];
  }

  const collectedRecords = [];

  for (const dbName of matchedDatabases) {
    logger.info(`Reading ${storeName} from ${dbName}`);
    const response = await readObjectStoreRecords(page, dbName, storeName);
    if (response.missing) {
      if (required) {
        throw new Error(
          `Database ${dbName} does not contain required store ${storeName}. Available stores: ${response.availableStores.join(", ")}`
        );
      }

      logger.info(`Store ${storeName} was not present in optional database ${dbName}`);
      continue;
    }

    for (const record of response.records) {
      collectedRecords.push({
        dbName,
        storeName,
        storageKey: record.storageKey,
        value: record.value
      });
    }
  }

  return collectedRecords;
}

async function writeJsonlAtomic(filePath, records) {
  const tempFilePath = `${filePath}.tmp-${process.pid}`;
  const fileHandle = await open(tempFilePath, "w");
  try {
    for (const record of records) {
      await fileHandle.write(`${JSON.stringify(record)}\n`);
    }
  } finally {
    await fileHandle.close();
  }

  await rename(tempFilePath, filePath);
}

async function writeAllOutputs(outDir, collections) {
  await mkdir(outDir, { recursive: true });

  const outputPaths = {};
  for (const [collectionName, fileName] of Object.entries(OUTPUT_FILES)) {
    const filePath = path.join(outDir, fileName);
    await writeJsonlAtomic(filePath, collections[collectionName] ?? []);
    outputPaths[collectionName] = filePath;
  }

  return outputPaths;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const logger = createLogger(options.verbose);

  logger.info(`Connecting to ${options.cdpUrl}`);
  const browser = await chromium.connectOverCDP(options.cdpUrl, {
    isLocal: true,
    timeout: 30_000
  });

  try {
    const page = await findTeamsPage(browser);
    const databaseNames = await listIndexedDbNames(page);

    logger.info(`Detected ${databaseNames.length} IndexedDB databases in the Teams page context`);

    const replyChainRecords = await collectMatchingStoreRecords({
      page,
      databaseNames,
      prefix: DB_PREFIXES.replyChain,
      storeName: STORE_NAMES.replyChain,
      required: true,
      logger
    });

    const conversationRecords = await collectMatchingStoreRecords({
      page,
      databaseNames,
      prefix: DB_PREFIXES.conversation,
      storeName: STORE_NAMES.conversation,
      required: true,
      logger
    });

    const calendarRecords = await collectMatchingStoreRecords({
      page,
      databaseNames,
      prefix: DB_PREFIXES.calendar,
      storeName: STORE_NAMES.calendar,
      required: false,
      logger
    });

    const contactRecords = await collectMatchingStoreRecords({
      page,
      databaseNames,
      prefix: DB_PREFIXES.contacts,
      storeName: STORE_NAMES.contacts,
      required: false,
      logger
    });

    const profileRecords = await collectMatchingStoreRecords({
      page,
      databaseNames,
      prefix: DB_PREFIXES.profiles,
      storeName: STORE_NAMES.profiles,
      required: false,
      logger
    });

    const { people, personIdentityIndex } = normalizePeopleRecords({
      contacts: contactRecords,
      profiles: profileRecords
    });

    const conversationRefIndex = new Map(
      conversationRecords.map((record) => [
        `${record.dbName}::${record.value.id}`,
        buildConversationCanonicalId(record.dbName, record.value.id)
      ])
    );

    const { messages, replyChains, messageRefLookup } = normalizeReplyChainsAndMessages({
      replyChainRecords,
      conversationRefIndex,
      personIdentityIndex
    });

    const chatThreads = normalizeChatThreads({
      conversationRecords,
      messageRefLookup,
      personIdentityIndex
    });

    const calendar = normalizeCalendarItems({
      calendarRecords,
      personIdentityIndex
    });

    const transcription = normalizeTranscriptions({
      messages,
      personIdentityIndex
    });

    const outputPaths = await writeAllOutputs(options.outDir, {
      replyChains,
      chatThreads,
      messages,
      calendar,
      people,
      transcription
    });

    const summary = {
      app: {
        title: await page.title(),
        url: page.url()
      },
      counts: {
        replyChains: replyChains.length,
        chatThreads: chatThreads.length,
        messages: messages.length,
        calendar: calendar.length,
        people: people.length,
        transcription: transcription.length
      },
      outputPaths
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
