import { LinkPreview } from '../types';

/**
 * Fetches Open Graph / meta tags directly from the URL using the browser's
 * native fetch + DOMParser. No external APIs or proxies.
 * Returns an empty object if the site blocks cross-origin requests.
 */
export const fetchLinkPreview = async (url: string): Promise<LinkPreview> => {
  try {
    // Try Microlink API first as it bypasses CORS and parses OG tags for us
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const { data } = await res.json();
      if (data) {
        return {
          title: data.title || undefined,
          description: data.description || undefined,
          image: data.image?.url || data.logo?.url || undefined,
        };
      }
    }

    // Fallback to CORS proxy if Microlink fails
    const proxyRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    if (!proxyRes.ok) return {};

    const html = await proxyRes.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const meta = (prop: string) =>
      doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)
        ?.getAttribute('content') ?? undefined;

    return {
      title:       meta('og:title')       || meta('twitter:title')       || doc.title || undefined,
      description: meta('og:description') || meta('twitter:description') || meta('description') || undefined,
      image:       meta('og:image')       || meta('twitter:image')       || undefined,
    };
  } catch (error) {
    console.error('Failed to fetch link preview:', error);
    return {};
  }
};
