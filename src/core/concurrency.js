/**
 * Bounded-parallelism map. Expanding a group fans out one request per
 * repository; without a cap that is a burst of hundreds of connections at a
 * registry that is usually a single container.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit Maximum number of workers running at once.
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>} Results in input order.
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };

  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}
