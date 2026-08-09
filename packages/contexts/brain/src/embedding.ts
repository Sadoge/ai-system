/** How the Brain turns text into embeddable chunks. Injected so the Brain never imports a provider SDK. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

const MAX_CHUNK_CHARS = 1200;

/**
 * Paragraph-greedy chunking: keep paragraphs whole where possible, split only
 * when a single block exceeds the budget. Knowledge items are short, so this
 * usually yields one chunk — the point is that long ADRs stay retrievable.
 */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}
