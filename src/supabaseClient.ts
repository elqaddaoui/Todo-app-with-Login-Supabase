import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'SUPABASE_PROJECT_URL_HERE'
const SUPABASE_PUBLIC_KEY = 'SUPABASE_PUBLISHABLE_KEY_HERE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY)
