import { redirect } from "next/navigation";

import { InboxScoutApp } from "@/components/inbox-scout-app";
import { hasSupabaseConfig, isDemoMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isDemoMode) {
    if (!hasSupabaseConfig()) redirect("/login?error=Supabase+is+not+configured");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
  }

  return <InboxScoutApp />;
}

