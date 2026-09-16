/**
 * Public surface of `@janosik/shared` — the domain model, the board reducer
 * and its inverse, the export/import envelope, storage keys and the API
 * contract shared with the future backend. No build step: consumers import
 * these TypeScript sources directly through their bundler/alias.
 */

export * from "./types/kanban";
export * from "./store/board-reducer";
export * from "./store/invert";
export * from "./store/migrate";
export * from "./store/seed-data";
export * from "./utils/text";
export * from "./utils/column-limits";
export * from "./utils/board-serialization";
export * from "./utils/storage-keys";
export * from "./api";
