import { createClient } from 'npm:@supabase/supabase-js@2.106.2'
import { crearHandlerSugerencia } from '../_shared/sugerencia.mjs'

Deno.serve(crearHandlerSugerencia({
  createClient,
  url: Deno.env.get('SUPABASE_URL') || '',
  publicKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
  providerKey: Deno.env.get('OPENROUTER_API_KEY') || '',
  model: Deno.env.get('OPENROUTER_MODEL') || '',
  origins: (Deno.env.get('EXAM_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean),
}))
