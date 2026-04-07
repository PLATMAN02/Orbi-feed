import { useEffect, useState, useCallback, useRef } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import {
  Settings, ExternalLink, RefreshCw, Loader2,
  Search, X, Link2, Sparkles, Plus,
  Sun, Moon, ChevronUp, ChevronDown, MessageSquareQuote,
  ChevronLeft, ChevronRight, Bookmark,
} from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { generateToolSummary } from './lib/geminiService';
import { importToDb } from './lib/webImporter';
import { fetchLinkPreview } from './lib/linkPreview';
import type { Tool, LinkPreview } from './types';
import appIcon from './assets/icon.png';

const PAGE_SIZE = 50;

// ─────────────────────────────────── utils ───────────────────────────────────

const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url.slice(0, 30); }
};

const resolveTitle = (name: string, url: string) => {
  try { new URL(name); return hostOf(url); }
  catch { return name; }
};

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const lsGet = (k: string) => {
  try {
    const val = localStorage.getItem(k);
    if (!val) return null;
    try { return JSON.parse(val); } catch { return val; }
  } catch { return null; }
};
const lsSet = (k: string, v: any) => {
  try {
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  } catch {}
};

// ─────────────────────────────────── constants ────────────────────────────────

const SOURCE_META: Record<string, { label: string; color: string }> = {
  hn:        { label: 'Hacker News', color: 'source-hn' },
  reddit:    { label: 'Reddit',      color: 'source-reddit' },
  community: { label: 'Community',   color: 'source-community' },
};

type TimeRange    = 'today' | 'week' | 'month' | 'all';
type SortBy       = 'new' | 'top';
type SourceFilter = 'all' | 'hn' | 'reddit' | 'community';

// ─────────────────────────────────── App ─────────────────────────────────────

export const App = () => {
  const [tools, setTools]       = useState<Tool[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(0);

  // filters
  const [timeRange, setTimeRange]       = useState<TimeRange>('all');
  const [sortBy, setSortBy]             = useState<SortBy>('new');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch]             = useState('');

  // submit panel
  const [showSubmit, setShowSubmit] = useState(false);
  const [url, setUrl]               = useState('');
  const urlRef = useRef(url);
  useEffect(() => { urlRef.current = url; }, [url]);
  const [context, setContext]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting]   = useState(false);

  // link preview
  const [preview, setPreview]               = useState<LinkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // theme
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (lsGet('orbio-theme') as 'dark' | 'light') ?? 'dark'
  );

  // settings
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(
    () => lsGet('orbio-api-key') || import.meta.env.VITE_GEMINI_API_KEY || ''
  );

  // votes — persisted so users can't double-vote after reload
  const [votedIds, setVotedIds] = useState<Record<string, 'up' | 'down'>>(() => {
    const data = lsGet('orbio-voted-ids');
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  });

  // bookmarks — persisted to localStorage
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => {
    const data = lsGet('orbio-bookmarks');
    return new Set(Array.isArray(data) ? data : []);
  });
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showIntro, setShowIntro] = useState(() => lsGet('orbio-intro-dismissed') !== 'true');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    lsSet('orbio-theme', theme);
  }, [theme]);

  useEffect(() => { lsSet('orbio-api-key', apiKey); }, [apiKey]);
  useEffect(() => { lsSet('orbio-voted-ids', votedIds); }, [votedIds]);
  useEffect(() => { lsSet('orbio-bookmarks', [...bookmarkedIds]); }, [bookmarkedIds]);

  // ── url input → debounced preview ────────────────────────────────────────
  const handleUrlChange = useCallback((value: string) => {
    setUrl(value);
    setPreview(null);
    if (previewTimer.current) clearTimeout(previewTimer.current);

    // Basic URL extraction regex
    const urlRegex = /(https?:\/\/[^\s]+)/i;
    const match = value.match(urlRegex);
    const targetUrl = match ? match[0] : value.trim();

    if (!targetUrl.includes('.') || targetUrl.length < 4) return;

    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      const p = await fetchLinkPreview(targetUrl);
      setPreview(Object.keys(p).length ? p : null);
      setPreviewLoading(false);
    }, 800);
  }, []);

  const handleClipboardLink = useCallback(async () => {
    if (!navigator.clipboard) {
      console.warn('Clipboard API not available');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const validText = text?.trim() || '';
      const isLink = validText.startsWith('http') || (validText.includes('.') && validText.length > 4 && !validText.includes(' '));
      
      if (isLink) {
        const lastLink = lsGet('orbio-last-link');
        if (validText !== lastLink) {
          if (urlRef.current && urlRef.current !== validText) {
            return;
          }
          lsSet('orbio-last-link', validText);
          setShowSubmit(true);
          handleUrlChange(validText);
          toast.success('Link detected from clipboard', { icon: '📋', id: 'clip-toast' });
        }
      }
    } catch (e) {
      console.error('Clipboard read failed:', e);
    }
  }, [handleUrlChange]);



  // Skip filter effect on first mount — startup effect handles initial load
  const didMountRef = useRef(false);

  // On startup: skip web import if last sync < 1 hour ago
  useEffect(() => {
    const lastRefresh = lsGet('orbio-last-refresh');
    const ONE_HOUR = 3_600_000;
    if (lastRefresh && Date.now() - Number(lastRefresh) < ONE_HOUR) {
      fetchTools(0);
    } else {
      handleRefresh();
    }
    didMountRef.current = true;
  }, []); // eslint-disable-line

  // Reset to page 0 on filter change (skip on mount)
  useEffect(() => {
    if (!didMountRef.current) return;
    setPage(0);
    fetchTools(0);
  }, [timeRange, sortBy, sourceFilter]); // eslint-disable-line

  // ── fetch from DB ─────────────────────────────────────────────────────────
  const fetchTools = async (targetPage = page) => {
    setLoading(true);
    const from = targetPage * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let q = supabase.from('tools').select('*', { count: 'exact' });

    if (timeRange !== 'all') {
      const cutMs: Record<TimeRange, number> = {
        today: 86_400_000, week: 604_800_000, month: 2_592_000_000, all: 0,
      };
      q = q.gte('created_at', new Date(Date.now() - cutMs[timeRange]).toISOString());
    }
    if (sourceFilter !== 'all') q = q.eq('source', sourceFilter);
    if (sortBy === 'top') q = q.order('upvotes_count', { ascending: false });
    else q = q.order('created_at', { ascending: false });

    const { data, error, count } = await q.range(from, to);
    console.debug('[fetchTools] result:', { dataCount: data?.length, error, count });
    if (error) { 
      console.error('[fetchTools] error:', error);
      toast.error('Failed to load feed'); 
    }
    else {
      setTools((data as Tool[]) ?? []);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  };

  const goToPage = (p: number) => {
    setPage(p);
    fetchTools(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── submit community link ─────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    let validUrl = url.trim();
    if (!/^https?:\/\//i.test(validUrl)) validUrl = 'https://' + validUrl;

    setSubmitting(true);
    const toastId = toast.loading('Checking…');
    try {
      const { data: existing } = await supabase.from('tools').select('id').eq('url', validUrl).maybeSingle();
      if (existing) { toast.error('Already in the feed!', { id: toastId }); return; }

      toast.loading('Fetching preview…', { id: toastId });
      const [summaryData, og] = await Promise.all([
        generateToolSummary(validUrl, context, apiKey),
        preview ? Promise.resolve(preview) : fetchLinkPreview(validUrl),
      ]);

      const rec = {
        url: validUrl,
        title: context || og.title || '',
        name: summaryData?.name ?? og.title ?? validUrl,
        summary: summaryData?.summary ?? og.description ?? 'Shared link',
        why_it_matters: summaryData?.whyItMatters ?? context ?? null,
        category: summaryData?.category ?? 'Uncategorized',
        tags: summaryData?.tags ?? [],
        source: 'community' as const,
        source_name: 'Community',
        submission_type: 'community' as const,
        upvotes_count: 0,
        downvotes_count: 0,
      };

      toast.loading('Publishing…', { id: toastId });
      let { data: inserted, error } = await supabase.from('tools').insert({
        ...rec, og_image: og.image ?? null, og_description: og.description ?? null,
      }).select().single();
      if (error?.code === '42703' || error?.message?.includes('og_') || error?.message?.includes('source_name') || error?.message?.includes('downvotes')) {
        ({ data: inserted, error } = await supabase.from('tools').insert(rec).select().single());
      }
      if (error) throw error;

      toast.success('Added to feed! 🎉', { id: toastId });
      setUrl(''); setContext(''); setPreview(null); setShowSubmit(false);
      if (inserted) setTools(prev => [inserted as Tool, ...prev]);
      setPage(0);
    } catch (err) {
      console.error(err);
      toast.error('Something went wrong.', { id: toastId });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Refresh: import new items to DB, then reload feed ────────────────────
  const handleRefresh = async (force = false) => {
    if (importing) return;
    const ONE_HOUR = 3_600_000;
    const lastRefresh = lsGet('orbio-last-refresh');
    const isFresh = lastRefresh && Date.now() - Number(lastRefresh) < ONE_HOUR;
    if (!force && isFresh) {
      fetchTools(0);
      setPage(0);
      return;
    }
    setImporting(true);
    lsSet('orbio-last-refresh', Date.now());
    const toastId = toast.loading('Fetching latest AI news…');
    try {
      const added = await importToDb((msg) => console.debug('[sync]', msg));
      await fetchTools(0);
      setPage(0);
      toast.success(
        added > 0 ? `Added ${added} new AI stories` : 'Feed is up to date',
        { id: toastId },
      );
    } catch (e) {
      toast.error('Sync failed', { id: toastId });
    } finally {
      setImporting(false);
    }
  };

  // ── client-side search + bookmark filter ────────────────────────────────
  const filtered = tools.filter(t => {
    if (showBookmarks && !bookmarkedIds.has(t.id)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const match = [t.name, t.summary, t.title, t.why_it_matters, ...(t.tags ?? [])]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
    return match;
  });

  console.debug('[render] tools:', tools.length, 'filtered:', filtered.length, {
    timeRange, sortBy, sourceFilter, showBookmarks
  });

  const sources: { id: SourceFilter; label: string }[] = [
    { id: 'all', label: 'All Sources' },
    { id: 'hn', label: 'Hacker News' },
    { id: 'reddit', label: 'Reddit' },
    { id: 'community', label: 'Community' },
  ];

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // ── vote ─────────────────────────────────────────────────────────────────
  const handleVote = async (tool: Tool, dir: 'up' | 'down') => {
    const existing = votedIds[tool.id];

    // Toggle off — same direction clicked again
    if (existing === dir) {
      const delta = dir === 'up'
        ? { upvotes_count: Math.max(0, (tool.upvotes_count ?? 0) - 1) }
        : { downvotes_count: Math.max(0, (tool.downvotes_count ?? 0) - 1) };
      setVotedIds(prev => { const n = { ...prev }; delete n[tool.id]; return n; });
      setTools(prev => prev.map(t => t.id === tool.id ? { ...t, ...delta } : t));
      await supabase.from('tools').update(delta).eq('id', tool.id);
      return;
    }

    // New vote or switch direction
    const delta: Partial<Tool> = {};
    if (dir === 'up') {
      delta.upvotes_count = (tool.upvotes_count ?? 0) + 1;
      if (existing === 'down') delta.downvotes_count = Math.max(0, (tool.downvotes_count ?? 0) - 1);
    } else {
      delta.downvotes_count = (tool.downvotes_count ?? 0) + 1;
      if (existing === 'up') delta.upvotes_count = Math.max(0, (tool.upvotes_count ?? 0) - 1);
    }

    // Optimistic update
    setVotedIds(prev => ({ ...prev, [tool.id]: dir }));
    setTools(prev => prev.map(t => t.id === tool.id ? { ...t, ...delta } : t));

    const { error } = await supabase.from('tools').update(delta).eq('id', tool.id);
    if (error) {
      // Rollback
      setTools(prev => prev.map(t => t.id === tool.id ? tool : t));
      setVotedIds(prev => { const n = { ...prev }; if (existing) n[tool.id] = existing; else delete n[tool.id]; return n; });
      toast.error('Vote failed — please try again');
    }
  };

  // ── bookmark toggle ──────────────────────────────────────────────────────
  const handleBookmark = (toolId: string) => {
    setBookmarkedIds(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  // ── AI Summarize on demand ────────────────────────────────────────────────
  const handleSummarize = async (tool: Tool) => {
    try {
      const summaryData = await generateToolSummary(tool.url, tool.summary || tool.title || '', apiKey);
      if (!summaryData) return false;
      const delta = {
        name: summaryData.name || tool.name,
        summary: summaryData.summary || tool.summary,
        why_it_matters: summaryData.whyItMatters || tool.why_it_matters,
        category: summaryData.category || tool.category,
        tags: summaryData.tags || tool.tags,
      };
      setTools(prev => prev.map(t => t.id === tool.id ? { ...t, ...delta } : t));
      await supabase.from('tools').update(delta).eq('id', tool.id);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-root">
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'var(--toast-bg)',
            color: 'var(--text-1)',
            border: '1px solid var(--border-2)',
            borderRadius: '10px',
            fontSize: '0.87rem',
          },
        }}
      />

      {/* ══════════════════ HEADER ══════════════════ */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <a href="/" className="logo-wrap" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <img 
                src={appIcon} 
                alt="Orbio icon" 
                className="app-logo-img"
              />
              <h1 className="logo-text">Orbio</h1>
            </a>
          </div>

          <div className="header-right">
            <button className="hdr-btn labeled desktop-only" onClick={() => {
              if (!showSubmit) handleClipboardLink();
              setShowSubmit(!showSubmit);
            }}>
              <Plus size={14} />
              <span className="hdr-btn-label">Post a Tool</span>
            </button>

            <button className="hdr-btn labeled" onClick={() => handleRefresh(true)} disabled={importing || loading}>
              {(importing || loading) ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
              <span className="hdr-btn-label">Refresh</span>
            </button>
            <button className="hdr-btn theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button className="hdr-btn icon-only" onClick={() => setShowSettings(true)}>
              <Settings size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* ══════════════════ SEARCH & FILTERS ══════════════════ */}
      <div className="search-filter-row">
        <div className="sf-content">
          <div className="search-input-wrap">
            <Search size={15} className="search-icon" />
            <input
              className="search-input"
              placeholder="Search articles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="time-select" value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRange)}>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All time</option>
          </select>
          <select className="time-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="new">Newest</option>
            <option value="top">Top Voted</option>
          </select>
        </div>
      </div>

      {/* ══════════════════ SOURCE CHIPS ══════════════════ */}
      <div className="category-bar">
        <div className="cb-content">
          {sources.map((src) => (
            <button
              key={src.id}
              className={`cat-chip ${sourceFilter === src.id && !showBookmarks ? 'active' : ''}`}
              data-source={src.id}
              onClick={() => { setShowBookmarks(false); setSourceFilter(src.id); }}
            >
              {src.id === 'hn'        && <span className="source-dot hn" />}
              {src.id === 'reddit'    && <span className="source-dot reddit" />}
              {src.id === 'community' && <span className="source-dot community" />}
              {src.label}
            </button>
          ))}
          <button
            className={`cat-chip ${showBookmarks ? 'active' : ''}`}
            onClick={() => setShowBookmarks(v => !v)}
          >
            <Bookmark size={12} />
            Bookmarks{bookmarkedIds.size > 0 && ` (${bookmarkedIds.size})`}
          </button>
        </div>
      </div>

      {/* ══════════════════ SUBMIT PANEL ══════════════════ */}
      {showSubmit && (
        <div className="submit-panel-wrap">
          <div className="submit-panel">
            <div className="submit-panel-head">
              <span className="submit-panel-title"><Link2 size={14} /> Share a Link</span>
              <button className="close-btn" onClick={() => setShowSubmit(false)}><X size={14} /></button>
            </div>
            <form onSubmit={handleSubmit} className="submit-form">
              <input
                type="url"
                className="s-input"
                placeholder="Paste URL here (e.g. google.com)…"
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                onFocus={() => {
                  if (!navigator.clipboard) {
                    toast.error('Use https or localhost for clipboard detection', { id: 'secure-ctx', duration: 2000 });
                  } else {
                    handleClipboardLink();
                  }
                }}
                required
                disabled={submitting}
                autoFocus
              />
              <div className="submit-row-2">
                <input
                  type="text"
                  className="s-input"
                  placeholder="Your take — why is this interesting?"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  disabled={submitting}
                />
                <button type="submit" className="btn-submit" disabled={submitting}>
                  {submitting ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                  {submitting ? 'Posting…' : 'Post'}
                </button>
              </div>
            </form>

            {(previewLoading || preview || (url && url.includes('.'))) && (
              <div className="link-preview">
                {previewLoading
                  ? <div className="preview-loading"><Loader2 size={12} className="spin" /> Fetching preview…</div>
                  : preview ? (
                    <div className="preview-inner">
                      {preview.image && (
                        <img src={preview.image} alt="og" className="preview-img"
                          onError={(e) => (e.currentTarget.style.display = 'none')} />
                      )}
                      <div className="preview-text">
                        {preview.title && <p className="preview-title">{preview.title}</p>}
                        {preview.description && <p className="preview-desc">{preview.description}</p>}
                        <button type="button" className="retry-preview-btn" onClick={() => handleUrlChange(url)}>
                          <RefreshCw size={10} /> Refresh Preview
                        </button>
                      </div>
                    </div>
                  ) : url.includes('.') && (
                    <div className="preview-none">
                      <span className="no-preview-msg">No preview available</span>
                      <button type="button" className="retry-preview-btn" onClick={() => handleUrlChange(url)}>
                        <RefreshCw size={10} /> Try Again
                      </button>
                    </div>
                  )
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════ INTRO MODAL (POPUP) ══════════════════ */}
      {showIntro && (
        <div className="intro-modal-overlay">
          <div className="intro-modal-box">
            <button 
              className="intro-close-btn" 
              onClick={() => {
                setShowIntro(false);
                lsSet('orbio-intro-dismissed', 'true');
              }}
              title="Close"
            >
              <X size={18} />
            </button>
            
            <div className="intro-modal-content">
              <div className="intro-header">
                <h2>Welcome to Orbio.</h2>
                <p>A high-signal discovery feed for the community, by the community.</p>
              </div>

              <div className="intro-grid">
                <div className="intro-col">
                  <div className="intro-col-label">
                    <Sparkles size={12} />
                    <span>The Feed</span>
                  </div>
                  <h3>AI-Powered Curation</h3>
                  <p>
                    Orbio aggregates high-signal projects from Hacker News, Reddit, and more, 
                    using Gemini AI to summarize what actually matters.
                  </p>
                </div>

                <div className="intro-col">
                  <div className="intro-col-label">
                    <Plus size={12} />
                    <span>How to share</span>
                  </div>
                  <h3>Share in 3 simple steps:</h3>
                  <div className="intro-steps">
                    <div className="intro-step">
                      <span className="step-num">1</span>
                      <p>Find a cool AI tool or story and <strong>copy the link</strong>.</p>
                    </div>
                    <div className="intro-step">
                      <span className="step-num">2</span>
                      <p>Click <strong>"Post a Tool"</strong> — we'll auto-detect the link from your clipboard!</p>
                    </div>
                    <div className="intro-step">
                      <span className="step-num">3</span>
                      <p>Add your take, and we'll handle the AI summary and preview for the feed.</p>
                    </div>
                  </div>
                </div>

                <div className="intro-col" style={{ gridColumn: 'span 2' }}>
                  <div className="intro-col-label">
                    <Sun size={12} />
                    <span>Why Orbio?</span>
                  </div>
                  <h3>Cut through the noise</h3>
                  <p>
                    One clean destination for staying ahead in the rapidly evolving AI landscape, 
                    without the distractions of traditional social media.
                  </p>
                </div>
              </div>

              <div className="intro-footer">
                <button 
                  className="btn-get-started"
                  onClick={() => {
                    setShowIntro(false);
                    lsSet('orbio-intro-dismissed', 'true');
                  }}
                >
                  Start Discovering
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="feed-main">
        <div className="feed-content">
          {loading && tools.length === 0 ? (
            <div className="empty-state">
              <Loader2 size={28} className="spin" style={{ color: 'var(--accent)' }} />
              <p>Fetching your feed…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <Sparkles size={28} opacity={0.3} />
              <p>
                {showBookmarks
                  ? 'No bookmarks yet — click the bookmark icon on any story'
                  : search
                    ? `No results for "${search}"`
                    : timeRange !== 'all'
                      ? 'No items in this time range — try "All Time"'
                      : 'Nothing yet — click Refresh!'}
              </p>
              {timeRange !== 'all' && (
                <button className="empty-action" onClick={() => setTimeRange('all')}>Show All Time</button>
              )}
            </div>
          ) : (
            <div className="feed-list">
              {filtered.map((tool) => (
                <FeedCard
                  key={tool.id}
                  tool={tool}
                  onVote={handleVote}
                  onSummarize={handleSummarize}
                  voted={votedIds[tool.id]}
                  bookmarked={bookmarkedIds.has(tool.id)}
                  onBookmark={handleBookmark}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && !loading && (
            <div className="pagination">
              <button className="page-btn" disabled={page === 0} onClick={() => goToPage(page - 1)}>
                <ChevronLeft size={15} /> Prev
              </button>
              <span className="page-info">
                Page {page + 1} of {totalPages}
                <span className="page-count"> · {totalCount} total</span>
              </span>
              <button className="page-btn" disabled={page >= totalPages - 1} onClick={() => goToPage(page + 1)}>
                Next <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
      </main>

      {/* ══════════════════ SETTINGS MODAL ══════════════════ */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Settings</h3>
              <button className="close-btn" onClick={() => setShowSettings(false)}><X size={15} /></button>
            </div>
            <label className="modal-lbl">Gemini API Key <span className="optional-tag">optional</span></label>
            <input
              type="password"
              className="s-input"
              style={{ width: '100%', marginTop: 8 }}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIza… (enables AI summaries)"
            />
            <p className="modal-hint">
              Works without a key — OG metadata is used automatically. For richer AI summaries, get a free key at{' '}
              <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">aistudio.google.com</a>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, gap: 10 }}>
              <button className="btn-submit" onClick={() => setShowSettings(false)}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ FLOATING ACTIONS ══════════════════ */}
      <button 
        className={`floating-share-btn mobile-only ${showSubmit ? 'active' : ''}`}
        onClick={() => {
          if (!showSubmit) handleClipboardLink();
          setShowSubmit(!showSubmit);
        }}
      >
        <Plus size={20} className="plus-icon" />
        <span>{showSubmit ? 'Close' : 'Post a Tool'}</span>
      </button>

      <style>{`.spin{animation:_s .85s linear infinite}@keyframes _s{100%{transform:rotate(360deg)}}`}</style>
    </div>
  );
};

// ─────────────────────────────────── FeedCard ────────────────────────────────

interface FeedCardProps {
  tool: Tool;
  onVote: (tool: Tool, dir: 'up' | 'down') => void;
  onSummarize: (tool: Tool) => Promise<boolean>;
  voted?: 'up' | 'down';
  bookmarked?: boolean;
  onBookmark?: (toolId: string) => void;
}

const FeedCard = ({ tool, onVote, onSummarize, voted, bookmarked, onBookmark }: FeedCardProps) => {
  const [summarizing, setSummarizing] = useState(false);
  const src = SOURCE_META[tool.source] ?? SOURCE_META.community;
  const sourceName = tool.source_name || src.label;
  const title = resolveTitle(tool.name, tool.url);

  const userNote = tool.why_it_matters &&
    !['Community submission', 'Community shared tool', 'Interesting find'].includes(tool.why_it_matters)
    ? tool.why_it_matters : null;

  return (
    <article className="feed-card">
      <div className="card-top-row">
        <div className="card-meta">
          <span className="meta-source">{sourceName}</span>
          <span className="meta-dot">·</span>
          <span className="meta-time">{timeAgo(tool.created_at)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {tool.category && tool.category !== 'Uncategorized' && (
            <span className="category-pill">{tool.category.toLowerCase()}</span>
          )}
          <button
            className="icon-only"
            style={{ background: 'none', border: 'none', color: bookmarked ? 'var(--accent)' : 'var(--text-3)', transition: 'color 0.15s' }}
            title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
            onClick={() => onBookmark?.(tool.id)}
          >
            <Bookmark size={14} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      <a href={tool.url} target="_blank" rel="noreferrer" className="card-title">
        {title}
      </a>

      {userNote && (
        <div className="user-note">
          <MessageSquareQuote size={13} className="user-note-icon" />
          <span>{userNote}</span>
        </div>
      )}

      {(tool.og_image || tool.og_description) && (
        <div className="card-preview-wrap">
          {tool.og_image && (
            <div className="card-preview-img-box">
              <img
                src={tool.og_image}
                alt={title}
                className="card-preview-img"
                onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
              />
            </div>
          )}
          {tool.og_description && !tool.summary.includes(tool.og_description) && (
            <p className="card-preview-desc">{tool.og_description}</p>
          )}
        </div>
      )}

      {tool.summary && tool.summary !== 'Shared link' && (
        <p className="card-summary">{tool.summary}</p>
      )}

      <div className="card-footer">
        <div className="card-footer-left">
          <a href={tool.url} target="_blank" rel="noreferrer" className="read-btn">
            Read article <ExternalLink size={12} />
          </a>
        </div>

        <div className="card-footer-right">
          <div className="inline-votes">
            <button
              className={`inline-vote-btn ${voted === 'up' ? 'voted' : ''}`}
              onClick={() => onVote(tool, 'up')}
              title="Upvote"
            >
              <ChevronUp size={14} />
            </button>
            <span className="vote-count">{(tool.upvotes_count ?? 0) - (tool.downvotes_count ?? 0)}</span>
            <button
              className={`inline-vote-btn down ${voted === 'down' ? 'voted' : ''}`}
              onClick={() => onVote(tool, 'down')}
              title="Downvote"
            >
              <ChevronDown size={14} />
            </button>
          </div>

          <button
            className="ai-summary-btn"
            onClick={async () => {
              if (summarizing) return;
              setSummarizing(true);
              const ok = await onSummarize(tool);
              if (!ok) toast.error('Failed to summarize.');
              setSummarizing(false);
            }}
            disabled={summarizing}
          >
            {summarizing ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {summarizing ? 'Summarizing...' : 'AI Summary'}
          </button>
        </div>
      </div>
    </article>
  );
};
