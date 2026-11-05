import { createClient } from 'npm:@supabase/supabase-js@2.106.2'
import { crearHandlerSugerencia } from '../_shared/sugerencia.mjs'

Deno.serve(crearHandlerSugerencia({
  createClient,
  url: Deno.env.get('SUPABASE_URL') || '',
  publicKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  providerKey: Deno.env.get('OPENROUTER_API_KEY') || '',
  models: (Deno.env.get('OPENROUTER_MODELS') || Deno.env.get('OPENROUTER_MODEL') || '').split(','),
  origins: (Deno.env.get('EXAM_ALLOWED_ORIGINS') || 'https://efesios.ujeladea.org,https://ujeladea.vercel.app').split(',').map(s => s.trim()).filter(Boolean),
}))
