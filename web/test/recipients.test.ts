import assert from "node:assert/strict";
import test from "node:test";
import { completeRecipientToken, replyRecipients } from "../src/mail/recipients.ts";

const address = (email: string) => ({ name: "", address: email });

test("reply uses Reply-To instead of From", () => {
  const result = replyRecipients({
    from: [address("sender@example.com")],
    replyTo: [address("help@example.com")],
    to: [address("me@example.com")],
    cc: [],
  }, "me@example.com", false);
  assert.deepEqual(result, { to: "help@example.com", cc: "" });
});

test("reply-all deduplicates case-insensitively and excludes own address", () => {
  const result = replyRecipients({
    from: [address("sender@example.com")],
    replyTo: [],
    to: [address("me@example.com"), address("friend@example.com")],
    cc: [address("FRIEND@example.com"), address("other@example.com")],
  }, "ME@example.com", true);
  assert.deepEqual(result, {
    to: "sender@example.com",
    cc: "friend@example.com, other@example.com",
  });
});

test("reply-all to a sent message addresses the other recipients", () => {
  const result = replyRecipients({
    from: [address("me@example.com")],
    replyTo: [],
    to: [address("friend@example.com")],
    cc: [address("team@example.com")],
  }, "me@example.com", true);
  assert.deepEqual(result, { to: "friend@example.com", cc: "team@example.com" });
});

test("contact completion replaces only the active comma-separated token", () => {
  assert.equal(completeRecipientToken("first@example.com, fr", "friend@example.com"),
    "first@example.com, friend@example.com");
});
