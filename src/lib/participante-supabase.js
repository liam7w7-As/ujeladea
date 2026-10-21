import { createClient } from '@supabase/supabase-js'
import { supabaseConfigurado } from './supabase'
import { crearApiExamen } from './examen-api'
import { instanciaExamen } from './acceso-examen'

const clienteParticipante = supabaseConfigurado ? createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { headers: { 'x-examen-instancia': instanciaExamen } }, auth: { storageKey: 'ujeladea_participante_auth_v2', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
) : null
export const apiExamen = clienteParticipante ? crearApiExamen(clienteParticipante) : null
