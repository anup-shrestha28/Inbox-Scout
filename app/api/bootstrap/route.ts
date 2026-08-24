import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { hasGmailConfig, hasSearchConfig, isDemoMode } from "@/lib/config";
import { DEMO_CAMPAIGNS, DEMO_LEADS } from "@/lib/demo-data";
import { getCampaigns } from "@/lib/repositories/campaigns";
import { getLeads } from "@/lib/repositories/leads";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/auth";
import type { AppBootstrap } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    if (isDemoMode) {
      const payload: AppBootstrap = {
        demoMode: true,
        searchConfigured: true,
        gmailConfigured: false,
        gmailConnected: false,
        connectedEmail: null,
        leads: DEMO_LEADS,
        campaigns: DEMO_CAMPAIGNS,
      };
      return NextResponse.json(payload);
    }

    const admin = createAdminClient();
    const [leads, campaigns, connectionResult] = await Promise.all([
      getLeads(user.id),
      getCampaigns(user.id),
      admin
        .from("gmail_connections")
        .select("connected_email")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const payload: AppBootstrap = {
      demoMode: false,
      searchConfigured: hasSearchConfig(),
      gmailConfigured: hasGmailConfig(),
      gmailConnected: Boolean(connectionResult.data),
      connectedEmail: connectionResult.data?.connected_email ?? null,
      leads,
      campaigns,
    };
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "Unable to load InboxScout.");
  }
}

