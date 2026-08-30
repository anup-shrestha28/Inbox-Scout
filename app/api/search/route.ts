import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { hasSearchConfig, isDemoMode } from "@/lib/config";
import { searchDemoLeads } from "@/lib/demo-data";
import { discoverLeads } from "@/lib/discovery/discover";
import { checkRateLimit } from "@/lib/rate-limit";
import { saveDiscoveredLeads } from "@/lib/repositories/leads";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { searchInputSchema, validationMessage } from "@/lib/validation";

export const maxDuration = 60;

export async function POST(request: Request) {
  let searchId: string | null = null;
  try {
    const user = await requireUser();
    if (!checkRateLimit(`search:${user.id}`, 4, 60_000)) {
      return NextResponse.json(
        { error: "Please wait a moment before starting another search." },
        { status: 429 },
      );
    }

    const parsed = searchInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 422 });
    }
    if (isDemoMode) {
      return NextResponse.json({ leads: searchDemoLeads(parsed.data), demo: true });
    }
    if (!hasSearchConfig()) {
      return NextResponse.json(
        { error: "Add TAVILY_API_KEY to enable live discovery." },
        { status: 503 },
      );
    }

    const supabase = await createClient();
    const { data: search, error: createError } = await supabase
      .from("searches")
      .insert({
        user_id: user.id,
        query: parsed.data.query,
        roles: parsed.data.roles,
        region_mode: parsed.data.regionMode,
        countries: parsed.data.countries,
        cities: parsed.data.cities,
        sources: parsed.data.sources,
        lead_type: parsed.data.leadType,
        status: "running",
      })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    searchId = search.id;

    const discovered = await discoverLeads(parsed.data);
    const leads = await saveDiscoveredLeads(user.id, search.id, discovered);
    await supabase
      .from("searches")
      .update({
        status: "completed",
        result_count: discovered.length,
        completed_at: new Date().toISOString(),
      })
      .eq("id", search.id)
      .eq("user_id", user.id);

    return NextResponse.json({ leads, addedCount: discovered.length, demo: false });
  } catch (error) {
    if (searchId && !isDemoMode) {
      try {
        const supabase = await createClient();
        await supabase
          .from("searches")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
            completed_at: new Date().toISOString(),
          })
          .eq("id", searchId);
      } catch {
        // Preserve the original search error.
      }
    }
    return apiError(error, "Lead discovery failed.");
  }
}
