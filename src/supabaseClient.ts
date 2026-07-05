import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://whjdybmttuyuhxshulva.supabase.co/rest/v1/'
const SUPABASE_PUBLIC_KEY = 'sb_publishable_T4HWIrRkNyOz00OP6VcqjA_iBNjlbq2'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY)
