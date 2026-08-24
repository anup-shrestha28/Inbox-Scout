import type { User } from "@supabase/supabase-js";

import { isDemoMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function requireUser(): Promise<User | { id: string; email: string }> {
  if (isDemoMode) {
    return { id: DEMO_USER_ID, email: "demo@inboxscout.local" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) throw new Error("UNAUTHORIZED");
  return user;
}

