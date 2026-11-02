# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched under `/databases/{database}/documents` is strictly denied (`allow read, write: if false;`).
2. **Verified Identity**: Every write operation requires an authenticated user with a verified email (`request.auth != null && request.auth.token.email_verified == true`).
3. **Path Variable Hardening (`isValidId`)**: All single-document operations (`get`, `create`, `update`, `delete`) validate path IDs with `isValidId(id)` (`id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`).
4. **Ownership & Query Enforcer**:
   - Every `Teacher` and `SubstituteRecord` document contains an `ownerId` matching `request.auth.uid` on creation.
   - `allow list` rules strictly enforce `resource.data.ownerId == request.auth.uid || isAdmin()` without calling `get()` inside `list`.
5. **Strict Key & Type Validation (`isValidTeacher`, `isValidSubstituteRecord`)**:
   - Creation enforces `keys().hasAll(...)` and `keys().hasOnly(...)`.
   - Updates wrap the entire block with `isValid[Entity](incoming())`, enforce immutable `ownerId` and `createdAt`, require `updatedAt == request.time`, and restrict modified fields with `incoming().diff(existing()).affectedKeys().hasOnly(...)`.
6. **Temporal Integrity**: `createdAt == request.time` on create, `updatedAt == request.time` on create and update.

## 2. The "Dirty Dozen" Payloads

1. **Unauthenticated Write**: Creating `/teachers/t_102` with `auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Creating `/teachers/t_102` with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Identity Spoofing (`ownerId` Mismatch)**: Creating `/teachers/t_102` where `ownerId != request.auth.uid` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Create**: Creating `/teachers/t_102` with extra field `isSuperAdmin: true` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection on Update**: Updating `/teachers/t_102` with extra field `hacked: "yes"` -> `PERMISSION_DENIED`.
6. **Immutable `ownerId` Tampering**: Updating `/teachers/t_102` to change `ownerId` -> `PERMISSION_DENIED`.
7. **Immutable `createdAt` Tampering**: Updating `/teachers/t_102` to change `createdAt` -> `PERMISSION_DENIED`.
8. **Forged Client Timestamp**: Creating `/teachers/t_102` with a past/future `createdAt != request.time` -> `PERMISSION_DENIED`.
9. **Value Poisoning (Oversized Name)**: Updating `/teachers/t_102` with `n` length > 120 characters -> `PERMISSION_DENIED`.
10. **Array Overflow (`coursesSummary`)**: Creating `/teachers/t_102` with `coursesSummary` having > 15 items -> `PERMISSION_DENIED`.
11. **Path ID Poisoning**: Creating `/teachers/invalid$id!` -> `PERMISSION_DENIED`.
12. **Unauthorized Cross-User List/Get**: Listing or getting `/substitute_records/{recordId}` belonging to another `ownerId` without admin privileges -> `PERMISSION_DENIED`.
