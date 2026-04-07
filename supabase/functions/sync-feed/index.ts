import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AI_REGEX =
  /\b(ai|llm|gpt|claude|openai|machine learning|artificial intelligence|midjourney|stable diffusion|anthropic|gemini|neural|deepseek|llama|mistral|inference|vector|agentic|agent|model|transformer|dataset|gpu|cuda|pytorch|tensorflow|embedding|fine-tune|rag|flux|sdxl|v0|bolt|copilot|assistant|bot|automating|automation|intelligence|vision|speech|nlu|nlp|generation|sideproject|saas|builder|dev|app|tool|platform|api|framework|library|software|startup|product|launch|built|creator|coding|developer)\b/i;

const isAIRelated = (text: string) => AI_REGEX.test(text);

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
  why_it_matters: null,
  source,
  source_name: sourceName,
  category: 'Uncategorized',
  tags: [],
  submission_type: 'web',
  score: 0,
  upvotes_count: 0,
  downvotes_count: 0,
  og_image: null,
  og_description: null,
});

Deno.serve(async (req) => {
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const candidates: any[] = [];
  const seenUrls = new Set<string>();

  const add = (
    url: string,
    rawTitle: string,
    source: 'hn' | 'reddit',
    sourceName: string,
  ) => {
    if (!url || !url.startsWith('http') || seenUrls.has(url)) return;
    if (!isAIRelated(rawTitle)) {
        console.log(`[skip] Not AI related: ${rawTitle.substring(0, 50)}...`);
        return;
    }
    seenUrls.add(url);
    console.log(`[add] ${source}: ${rawTitle.substring(0, 50)}...`);
    candidates.push(buildRecord(url, rawTitle, source, sourceName));
  };

  try {
    // 1. Hacker News: Show HN
    const hnShowRes = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=50',
    );
    const hnShowData = await hnShowRes.json();
    for (const hit of hnShowData.hits ?? []) {
      add(hit.url || hit.story_url || '', hit.title ?? '', 'hn', 'Show HN');
    }

    // 2. Hacker News: Front Page
    const hnFrontRes = await fetch(
      'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50',
    );
    const hnFrontData = await hnFrontRes.json();
    for (const hit of hnFrontData.hits ?? []) {
        const url = hit.url || hit.story_url || '';
        if (url.includes('ycombinator.com')) continue;
        add(url, hit.title ?? '', 'hn', 'Hacker News');
    }

    // 3. Reddit: r/SideProject
    const redditRes = await fetch(
      'https://www.reddit.com/r/SideProject/hot.json?limit=25&raw_json=1',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
        },
      },
    );
    if (redditRes.ok) {
      const redditData = await redditRes.json();
      for (const post of redditData?.data?.children ?? []) {
        const { url, url_overridden_by_dest, title, selftext } = post.data;
        const targetUrl = url_overridden_by_dest || url;
        if (targetUrl?.includes('reddit.com/r/') || targetUrl?.includes('v.redd.it')) continue;
        const raw = `${title ?? ''} ${selftext?.substring(0, 200) ?? ''}`.trim();
        add(targetUrl || '', raw, 'reddit', 'r/SideProject');
      }
    }

    if (candidates.length > 0) {
      console.log(`Attempting to upsert ${candidates.length} candidates...`);
      const { error } = await supabaseClient
        .from('tools')
        .upsert(candidates, { onConflict: 'url', ignoreDuplicates: true });
      
      if (error) {
          console.error('Upsert error:', error);
          throw error;
      }
    }

    return new Response(JSON.stringify({ success: true, count: candidates.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
