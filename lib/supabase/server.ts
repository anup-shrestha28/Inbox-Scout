import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requiredEnv, supabasePublicKey } from "@/lib/config";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublicKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot write cookies; Route Handlers can.
          }
        },
      },
    },
  );
}
