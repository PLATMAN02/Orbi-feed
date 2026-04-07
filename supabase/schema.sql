-- ==============================================================================
-- Orbio Database Schema & RLS Policies (MVP)
-- ==============================================================================
-- NOTE: This script assumes you are running it inside your Supabase SQL editor.
-- We do not automatically apply this via MCP, but you can copy/paste it or 
-- use standard migration workflows if needed.
-- ==============================================================================

-- Create the tools table
CREATE TABLE IF NOT EXISTS public.tools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url text UNIQUE NOT NULL,
    name text NOT NULL,
    title text,
    summary text,
    why_it_matters text,
    source text CHECK (source IN ('community', 'reddit', 'hn')),
    category text,
    tags jsonb DEFAULT '[]'::jsonb,
    submission_type text CHECK (submission_type IN ('community', 'web')),
    score integer DEFAULT 0,
    upvotes_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

-- Note: We are setting MVP-level security. 
-- For production, anonymous inserts should likely require rate limiting or captcha.
-- UPDATE and DELETE operations are omitted entirely so they are denied by default to public users.

-- Policy: Allow public read access
CREATE POLICY "Allow public read access"
ON public.tools
FOR SELECT
TO public
USING (true);

-- Policy: Allow anonymous insert (MVP only)
CREATE POLICY "Allow anonymous insert"
ON public.tools
FOR INSERT
TO public
WITH CHECK (true);

-- End of schema
