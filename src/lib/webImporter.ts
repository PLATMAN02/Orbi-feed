import { supabase } from './supabaseClient';

// ─── Main export: invoke the server-side sync function ────────────────────────
export const importToDb = async (
  onProgress?: (msg: string) => void,
): Promise<number> => {
  const log = (msg: string) => onProgress?.(msg);

  log('Starting remote sync (Supabase Edge Function)…');

  try {
    const { data, error } = await supabase.functions.invoke('sync-feed');

    if (error) {
      console.error('Edge Function error:', error);
      throw error;
    }

    if (data?.success) {
      log(`Synced ${data.count} items.`);
      return data.count;
    } else {
      console.error('Sync failed:', data?.error);
      return 0;
    }
  } catch (e) {
    console.error('Failed to invoke sync function:', e);
    return 0;
  }
};
