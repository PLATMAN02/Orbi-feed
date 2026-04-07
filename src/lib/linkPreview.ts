import { LinkPreview } from '../types';

/**
 * Fetches Open Graph / meta tags for a URL.
 * Uses Microlink (free tier) and falls back to an open-source CORS proxy (allorigins.win).
 */
export const fetchLinkPreview = async (url: string): Promise<LinkPreview> => {
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  console.debug('[fetchLinkPreview] fetching:', targetUrl);

  try {
    // 1. Try Microlink API (excellent for JS-heavy sites)
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(targetUrl)}`);
    if (res.ok) {
      const { data } = await res.json();
      if (data && (data.title || data.description)) {
        console.debug('[fetchLinkPreview] microlink success');
        return {
          title: data.title || undefined,
          description: data.description || undefined,
          image: data.image?.url || data.logo?.url || undefined,
        };
      }
    }

    console.debug('[fetchLinkPreview] microlink failed or empty, trying fallback proxy...');

    // 2. Fallback: Use open-source CORS proxy (AllOrigins)
    // This fetches the raw HTML and we parse it locally.
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    const proxyRes = await fetch(proxyUrl);
    
    if (!proxyRes.ok) {
      console.warn('[fetchLinkPreview] proxy failed:', proxyRes.status);
      return {};
    }

    const json = await proxyRes.json();
    const html = json.contents;
    if (!html) return {};

    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Robust meta extraction
    const getMeta = (names: string[]) => {
      for (const name of names) {
        const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`);
        const content = el?.getAttribute('content');
        if (content) return content;
      }
      return undefined;
    };

    const result = {
      title:       getMeta(['og:title', 'twitter:title', 'title']) || doc.title || undefined,
      description: getMeta(['og:description', 'twitter:description', 'description']),
      image:       getMeta(['og:image', 'twitter:image', 'image', 'thumbnail']) || 
                   `https://free.pagepeeker.com/v2/thumbs.php?size=m&url=${encodeURIComponent(targetUrl)}`,
    };
    
    console.debug('[fetchLinkPreview] fallback result:', result.title);
    return result;
  } catch (error) {
    console.error('[fetchLinkPreview] error:', error);
    return {};
  }
};
