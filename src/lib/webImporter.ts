import { supabase } from './supabaseClient';

// ─── AI keyword filter ────────────────────────────────────────────────────────
const AI_REGEX =
  /\b(ai|llm|gpt|claude|openai|machine learning|artificial intelligence|midjourney|stable diffusion|anthropic|gemini|neural|deepseek|llama|mistral|inference|vector|agentic|agent|model|transformer|dataset|gpu|cuda|pytorch|tensorflow|embedding|fine-tune|rag|flux|sdxl|v0|bolt|copilot|assistant)\b/i;

const isAIRelated = (text: string) => AI_REGEX.test(text);

// ─── Build a DB record using only API-provided data (no extra fetch) ──────────
const buildRecord = (
  url: string,
  rawTitle: string,
  source: 'hn' | 'reddit',
  sourceName: string,
) => ({
  url,
  name: rawTitle.substring(0, 120) || url,
  title: rawTitle.substring(0, 200) || null,
  summary: rawTitle.substring(0, 200) || '',
  why_it_matters: null as string | null,
  source,
  source_name: sourceName,
  category: 'Uncategorized',
  tags: [] as string[],
  submission_type: 'web' as const,
  score: 0,
  upvotes_count: 0,
  downvotes_count: 0,
  og_image: null as string | null,
  og_description: null as string | null,
});

// ─── Main export: fetch from web and save new items directly to DB ────────────
export const importToDb = async (
  onProgress?: (msg: string) => void,
): Promise<number> => {
  const log = (msg: string) => onProgress?.(msg);
  const candidates: ReturnType<typeof buildRecord>[] = [];
  const seenUrls = new Set<string>();

  const add = (
    url: string,
    rawTitle: string,
    source: 'hn' | 'reddit',
    sourceName: string,
  ) => {
    if (!url || !url.startsWith('http') || seenUrls.has(url)) return;
    if (!isAIRelated(rawTitle)) return;
    seenUrls.add(url);
    log(`+ ${rawTitle.substring(0, 45)}…`);
    candidates.push(buildRecord(url, rawTitle, source, sourceName));
  };

  // ─── Hacker News: Show HN ──────────────────────────────────────────────────
  log('Scanning Show HN…');
  try {
    const res = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=50',
    );
    const data = await res.json();
    for (const hit of data.hits ?? []) {
      add(hit.url || hit.story_url || '', hit.title ?? '', 'hn', 'Show HN');
    }
  } catch (e) { console.error('HN Show HN:', e); }

  // ─── Hacker News: Front Page ───────────────────────────────────────────────
  log('Scanning HN Front Page…');
  try {
    const res = await fetch(
      'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50',
    );
    const data = await res.json();
    for (const hit of data.hits ?? []) {
      const url = hit.url || hit.story_url || '';
      if (url.includes('ycombinator.com')) continue;
      add(url, hit.title ?? '', 'hn', 'Hacker News');
    }
  } catch (e) { console.error('HN Front Page:', e); }

  // ─── Hacker News: Targeted AI search ──────────────────────────────────────
  log('Searching HN for AI stories…');
  try {
    const res = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=100&query=ai+OR+llm+OR+gpt+OR+agent+OR+llama',
    );
    const data = await res.json();
    for (const hit of data.hits ?? []) {
      add(hit.url || hit.story_url || '', hit.title ?? '', 'hn', 'Hacker News');
    }
  } catch (e) { console.error('HN AI search:', e); }

  // ─── Reddit: r/SideProject ─────────────────────────────────────────────────
  log('Scanning Reddit r/SideProject…');
  try {
    const res = await fetch(
      'https://www.reddit.com/r/SideProject/hot.json?limit=25&raw_json=1',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
        },
      },
    );
    if (!res.ok) throw new Error(`Reddit ${res.status}`);
    const json = await res.json();
    for (const post of json?.data?.children ?? []) {
      const { url, url_overridden_by_dest, title, selftext } = post.data;
      const targetUrl = url_overridden_by_dest || url;
      if (targetUrl?.includes('reddit.com/r/') || targetUrl?.includes('v.redd.it')) continue;
      const raw = `${title ?? ''} ${selftext?.substring(0, 200) ?? ''}`.trim();
      add(targetUrl || '', raw, 'reddit', 'r/SideProject');
    }
  } catch (e) { console.warn('Reddit sync skipped (CORS or network)'); }

  if (candidates.length === 0) return 0;

  // Upsert — skip URLs already in DB (requires unique constraint on url column)
  const { error } = await supabase
    .from('tools')
    .upsert(candidates, { onConflict: 'url', ignoreDuplicates: true });

  if (error) {
    console.error('DB import error:', error);
    return 0;
  }

  return candidates.length;
};
