
/** Shuffles an array of items in place (used for randomizing playlists) */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(random() * (index + 1)));
    const current = result[index];
    const other = result[swapIndex];
    if (current === undefined || other === undefined) continue;
    result[index] = other;
    result[swapIndex] = current;
  }
  return result;
}
