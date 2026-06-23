/** Product identity — kept in one place so the wordmark is consistent everywhere.
 *  The version is resolved at runtime (build-stamped, or `git describe` in dev) and
 *  threaded through the store as `app.version`. */
export const BRAND = {
  name: "friday",
  suffix: "code",
} as const
