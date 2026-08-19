/**
 * How many versions of a repository to show before truncating.
 *
 * A repository with 115 tags pushes every other image off the popup, so a rail
 * shows only the newest few until the user asks for the rest. Tags arrive
 * newest-first, so the head of the list is the useful part.
 */

export const PREVIEW_LIMIT = 6;

/**
 * @param {string[]} tags Newest first.
 * @param {object} [options]
 * @param {boolean} [options.expanded] User asked to see them all.
 * @param {boolean} [options.filtered] A filter is narrowing the list already.
 * @param {number}  [options.limit]
 * @returns {{shown: string[], hidden: number, collapsible: boolean}}
 */
export function railTags(tags, { expanded = false, filtered = false, limit = PREVIEW_LIMIT } = {}) {
  // A filtered rail is already short and deliberate; truncating it again would
  // hide the very matches the user searched for.
  if (filtered || tags.length <= limit) {
    return { shown: [...tags], hidden: 0, collapsible: false };
  }
  if (expanded) {
    return { shown: [...tags], hidden: 0, collapsible: true };
  }
  return { shown: tags.slice(0, limit), hidden: tags.length - limit, collapsible: true };
}
