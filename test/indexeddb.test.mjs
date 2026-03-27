import test from "node:test";
import assert from "node:assert/strict";
import { selectMatchingDatabaseNames } from "../src/indexeddb.mjs";

test("selectMatchingDatabaseNames keeps matching databases in sorted unique order", () => {
  const databases = [
    "Teams:conversation-manager:react-web-client:tenant-b",
    "Teams:replychain-manager:react-web-client:tenant-a",
    "Teams:conversation-manager:react-web-client:tenant-a",
    "Teams:conversation-manager:react-web-client:tenant-a",
    "unrelated-db"
  ];

  assert.deepEqual(selectMatchingDatabaseNames(databases, "Teams:conversation-manager:react-web-client:"), [
    "Teams:conversation-manager:react-web-client:tenant-a",
    "Teams:conversation-manager:react-web-client:tenant-b"
  ]);
});
