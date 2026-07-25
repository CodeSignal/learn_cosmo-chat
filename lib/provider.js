/**
 * Backend selection for a course.
 *
 * Existing courses omit this flag (or set it false) and keep the Octavus agent
 * path unchanged. AWS courses opt in with `"useBedrock": true` in
 * chat-config.json — nothing else about those older configs needs to change.
 */

/** @param {Record<string, unknown>} [config] */
export function usesBedrock(config = {}) {
  return config.useBedrock === true;
}
