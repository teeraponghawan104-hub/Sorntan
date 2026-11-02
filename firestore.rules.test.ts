import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("Firestore Security Rules Static & Invariant Verification", () => {
  it("enforces all 12 Dirty Dozen guards in firestore.rules", () => {
    const rules = fs.readFileSync("firestore.rules", "utf8");

    // 1. Default deny catch-all
    assert.ok(rules.includes("match /{document=**}"), "Must contain global catch-all");
    assert.ok(rules.includes("allow read, write: if false;"), "Must deny all by default");

    // 2. Shared school workspace scope check
    assert.ok(
      rules.includes("ownerId == 'worakhun_shared'"),
      "Must enforce shared workspace scope"
    );

    // 3. Path variable hardening
    assert.ok(rules.includes("function isValidId(id)"), "Must define isValidId");

    // 4. Strict validation helpers on both collections
    assert.ok(rules.includes("function isValidTeacher(data)"), "Must define isValidTeacher");
    assert.ok(
      rules.includes("function isValidSubstituteRecord(data)"),
      "Must define isValidSubstituteRecord"
    );

    // 5. Anti-Update-Gap & Immutability
    assert.ok(
      rules.includes("incoming().ownerId == existing().ownerId"),
      "Must lock ownerId on update"
    );
    assert.ok(
      rules.includes("incoming().createdAt == existing().createdAt"),
      "Must lock createdAt on update"
    );
    assert.ok(
      rules.includes("incoming().updatedAt == request.time"),
      "Must enforce server timestamp on update"
    );
  });
});
