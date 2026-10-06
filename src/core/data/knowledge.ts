import { validateKnowledgeIndex, type KnowledgeIndex } from '../ai/knowledge';

let indexPromise: Promise<KnowledgeIndex> | null = null;

export function loadKnowledgeIndex(): Promise<KnowledgeIndex> {
  if (indexPromise) return indexPromise;
  indexPromise = fetch('./generated/ai/knowledge.json.gz')
    .then((response) => {
      if (!response.ok) throw new Error(`AI knowledge index request failed (${response.status})`);
      if (response.headers.get('content-encoding')?.toLowerCase().includes('gzip')) {
        return response.json() as Promise<unknown>;
      }
      if (!response.body) throw new Error('AI knowledge index response has no body');
      const body = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(body).json() as Promise<unknown>;
    })
    .then((value) => {
      if (!validateKnowledgeIndex(value)) throw new Error('AI knowledge index has an unsupported or invalid shape');
      return value;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}
