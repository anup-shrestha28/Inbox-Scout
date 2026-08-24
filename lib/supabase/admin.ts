import { createClient } from "@supabase/supabase-js";

import { requiredEnv, supabaseSecretKey } from "@/lib/config";

export function createAdminClient() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseSecretKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
