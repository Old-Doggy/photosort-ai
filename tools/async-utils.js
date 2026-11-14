export async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
