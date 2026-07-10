// Temporary root barrel (ADR 0032): re-exports the module barrels so existing
// `@mmo/core` consumers stay green during the carve. Removed in the follow-up —
// consumers migrate to `@mmo/core/<module>` subpaths.

export * from './combat';
export * from './entities';
export * from './items';
export * from './persistence';
export * from './physics';
export * from './progression';
export * from './protocol';
export * from './sprites';
export * from './world';
export * from './zones';
