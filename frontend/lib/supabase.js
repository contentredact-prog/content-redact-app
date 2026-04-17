import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dkppcuotnphzjcmncnjg.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrcHBjdW90bnBoempjbW5jbmpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDk4MzMsImV4cCI6MjA5MTkyNTgzM30.tacRkv1Hk4sqHySTxGtfoOxNh0HYnFoEyMtTVAkwSlA";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);