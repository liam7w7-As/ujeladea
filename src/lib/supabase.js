import { createClient } from '@supabase/supabase-js'
import { configuracionPublicaValida } from './configuracion'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabaseConfigurado = configuracionPublicaValida(url, key)
export const supabase = supabaseConfigurado ? createClient(url, key) : null
