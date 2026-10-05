import assert from "node:assert/strict";
import test from "node:test";
import { requireTrashDestination, TrashUnavailableError } from "../src/mail/session.ts";

test("ordinary delete requires a different, existing Trash folder", () => {
  assert.equal(requireTrashDestination("INBOX", "Trash"), "Trash");
  assert.throws(() => requireTrashDestination("INBOX", null), TrashUnavailableError);
  assert.throws(() => requireTrashDestination("Trash", "Trash"), TrashUnavailableError);
});
