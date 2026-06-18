# SyncService — Future Reintroduction Guide

> This folder contains the **reference copy** of the old SyncService and its performance test.
> It was moved out of `src/` during the Phase 1 refactoring because it was tightly coupled into the data layer (`db.ts`, `CharacterCleanup.ts`).

---

## Why it was removed from the hot path

1. **`db.ts` called `syncService.scheduleUpload()` directly** inside `updateLastModified()`.  
   This meant the data layer knew about a host-UI file-upload service.
2. **`CharacterCleanup.ts` dynamically imported SyncService** to call `.purge()`.  
   Cleanup logic should return what was deleted; orchestration should live in the integration layer.
3. **`db.ts` polled `syncService.isImportingState`** to skip updates during import.  
   The data layer should not know about import locks.
4. **Toasts were emitted from inside upload/download methods.**  
   After Phase 2.3, services return results; the caller decides whether to toast.

---

## Reintroduction Checklist

### 1. Pick the right home

**Before:** `src/data/sync/SyncService.ts`  
**After:** `src/integrations/tavern/sync/SyncService.ts`

`data/` → `core/` only. SyncService talks to ST's file server, ST context, and UI notifications. It is an **integration**, not storage.

### 2. Invert the dependency on `db.ts`

`ChatDatabase.updateLastModified()` should **not** import SyncService.

Instead, emit a domain event:

```ts
// src/data/db.ts (stays pure)
private updateLastModified() {
    // ...write meta only...
    EventBus.emit("DB_MUTATED", { chatId: this.chatId, timestamp: Date.now() });
}
```

Then subscribe in the integration layer:

```ts
// src/integrations/tavern/sync/SyncService.ts
EventBus.on("DB_MUTATED", ({ chatId }) => syncService.scheduleUpload(chatId));
```

This keeps `data/` ignorant of *who* cares about mutations.

### 3. Inject config; do not reach for `SettingsManager`

```ts
// src/integrations/tavern/bootstrap.ts
const syncConfig = SettingsManager.getSyncSettings();
SyncService.init(syncConfig); // or pass into constructor
```

Remove all `SettingsManager.get(...)` calls from inside upload/download.

### 4. Handle the import lock locally

Replace the old `syncService.isImportingState` flag polled by `db.ts` with a private `Set` inside SyncService:

```ts
class SyncService {
    private importLocks = new Set<string>();

    async download(chatId: string) {
        this.importLocks.add(chatId);
        try {
            const data = await this.fetchRemote(chatId);
            await importChatData(db, data); // pure data helper
        } finally {
            this.importLocks.delete(chatId);
        }
    }

    scheduleUpload(chatId: string) {
        if (this.importLocks.has(chatId)) return;
        // ...debounce upload...
    }
}
```

### 5. Return results, don't toast from the service

```ts
// SyncService.ts
async upload(chatId: string): Promise<{ ok: true } | { ok: false; error: string }>

// bootstrap.ts or a small adapter
const result = await SyncService.upload(chatId);
if (!result.ok) notificationService.error(result.error);
```

### 6. Wire only in `bootstrap.ts`

No other module should dynamically `import("@/integrations/tavern/sync/SyncService")`.
If `CharacterCleanup` needs a remote purge, return the affected `chatId`s and let `bootstrap.ts` (or an adapter) call `SyncService.purge()`.

---

## Files in this folder

| File | Description |
|------|-------------|
| `SyncService.ts` | Last known source snapshot (v1.4.x era). |
| `sync-performance.test.ts` | Old Vitest performance test. Will need path fixes if revived. |

---

## Summary Table

| Concern | Before (bad) | After (good) |
|---|---|---|
| **Location** | `src/data/sync/` | `src/integrations/tavern/sync/` |
| **Trigger** | `db.ts` calls `syncService.scheduleUpload()` | `db.ts` emits event; SyncService listens |
| **Config** | `SettingsManager.get()` inside methods | Injected at `init()` from `bootstrap.ts` |
| **Import lock** | `syncService.isImportingState` polled by `db.ts` | Private `Set` inside SyncService |
| **Notifications** | `notificationService.*` called inside SyncService | Return results; caller decides to toast |
| **Cleanup wiring** | `CharacterCleanup.ts` dynamically imports SyncService | SyncService listens to events, or cleanup returns IDs and `bootstrap.ts` orchestrates purge |
