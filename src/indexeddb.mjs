function assertPlaywrightPage(page) {
  if (!page || typeof page.evaluate !== "function") {
    throw new TypeError("Expected a Playwright Page-like object with an evaluate() method");
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

export function selectMatchingDatabaseNames(databaseNames, prefix) {
  assertNonEmptyString(prefix, "prefix");

  if (!Array.isArray(databaseNames)) {
    return [];
  }

  return [...new Set(
    databaseNames.filter((databaseName) => typeof databaseName === "string" && databaseName.startsWith(prefix))
  )].sort((left, right) => left.localeCompare(right));
}

export async function listIndexedDbNames(page) {
  assertPlaywrightPage(page);

  const databaseNames = await page.evaluate(async () => {
    if (!globalThis.indexedDB || typeof globalThis.indexedDB.databases !== "function") {
      throw new Error("indexedDB.databases() is not available in the page context");
    }

    const databases = await globalThis.indexedDB.databases();
    return databases
      .map((database) => database?.name)
      .filter((databaseName) => typeof databaseName === "string" && databaseName.length > 0);
  });

  return [...new Set(databaseNames)].sort((left, right) => left.localeCompare(right));
}

export async function readObjectStoreRecords(page, dbName, storeName) {
  assertPlaywrightPage(page);
  assertNonEmptyString(dbName, "dbName");
  assertNonEmptyString(storeName, "storeName");

  return page.evaluate(
    async ({ requestedDbName, requestedStoreName }) => {
      const openRequest = globalThis.indexedDB.open(requestedDbName);
      let upgradeTriggered = false;

      const database = await new Promise((resolve, reject) => {
        openRequest.onupgradeneeded = () => {
          upgradeTriggered = true;
          try {
            openRequest.transaction?.abort();
          } catch {
            // Best effort only; the failure path is handled after success/error fires.
          }
        };

        openRequest.onblocked = () => {
          reject(new Error(`Opening IndexedDB database ${requestedDbName} was blocked`));
        };

        openRequest.onerror = () => {
          reject(openRequest.error ?? new Error(`Failed to open IndexedDB database ${requestedDbName}`));
        };

        openRequest.onsuccess = () => {
          resolve(openRequest.result);
        };
      });

      if (upgradeTriggered) {
        database.close();
        throw new Error(
          `Opening IndexedDB database ${requestedDbName} unexpectedly triggered upgradeneeded; the database may no longer exist`
        );
      }

      const availableStores = [];
      for (let index = 0; index < database.objectStoreNames.length; index += 1) {
        const storeName = database.objectStoreNames.item(index);
        if (typeof storeName === "string" && storeName.length > 0) {
          availableStores.push(storeName);
        }
      }
      availableStores.sort((left, right) => left.localeCompare(right));

      if (!database.objectStoreNames.contains(requestedStoreName)) {
        database.close();
        return {
          missing: true,
          availableStores,
          records: []
        };
      }

      const transaction = database.transaction(requestedStoreName, "readonly");
      const objectStore = transaction.objectStore(requestedStoreName);
      const records = [];

      try {
        await new Promise((resolve, reject) => {
          transaction.onabort = () => {
            reject(
              transaction.error ??
                new Error(`IndexedDB transaction aborted while reading ${requestedStoreName} from ${requestedDbName}`)
            );
          };

          transaction.onerror = () => {
            reject(
              transaction.error ??
                new Error(`IndexedDB transaction failed while reading ${requestedStoreName} from ${requestedDbName}`)
            );
          };

          const cursorRequest = objectStore.openCursor();
          cursorRequest.onerror = () => {
            reject(
              cursorRequest.error ??
                new Error(`Failed to iterate ${requestedStoreName} from IndexedDB database ${requestedDbName}`)
            );
          };

          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              resolve();
              return;
            }

            records.push({
              storageKey: cursor.primaryKey,
              value: cursor.value
            });
            cursor.continue();
          };
        });
      } finally {
        database.close();
      }

      return {
        missing: false,
        availableStores,
        records
      };
    },
    {
      requestedDbName: dbName,
      requestedStoreName: storeName
    }
  );
}
