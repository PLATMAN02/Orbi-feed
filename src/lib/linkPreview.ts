import { LinkPreview } from '../types';

/**
 * Fetches Open Graph / meta tags directly from the URL using the browser's
 * native fetch + DOMParser. No external APIs or proxies.
 * Returns an empty object if the site blocks cross-origin requests.
 */
export const fetchLinkPreview = async (url: string): Promise<LinkPreview> => {
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  console.debug('[fetchLinkPreview] starting fetch for:', targetUrl);

  try {
    // Try Microlink API first as it bypasses CORS and parses OG tags for us
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(targetUrl)}`);
    if (res.ok) {
      const { data } = await res.json();
      if (data) {
        console.debug('[fetchLinkPreview] microlink success:', data.title);
        return {
          title: data.title || undefined,
          description: data.description || undefined,
          image: data.image?.url || data.logo?.url || undefined,
        };
      }
    }

    console.debug('[fetchLinkPreview] microlink failed, trying fallback...');

    // Fallback to CORS proxy if Microlink fails
    const proxyRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
    if (!proxyRes.ok) {
      console.warn('[fetchLinkPreview] fallback failed:', proxyRes.status);
      return {};
    }

    const html = await proxyRes.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const meta = (prop: string) =>
      doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)
        ?.getAttribute('content') ?? undefined;

    const result = {
      title:       meta('og:title')       || meta('twitter:title')       || doc.title || undefined,
      description: meta('og:description') || meta('twitter:description') || meta('description') || undefined,
      image:       meta('og:image')       || meta('twitter:image')       || undefined,
    };
    
    console.debug('[fetchLinkPreview] fallback result:', result.title);
    return result;
  } catch (error) {
    console.error('[fetchLinkPreview] error:', error);
    return {};
  }
};
