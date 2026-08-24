import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { isDemoMode } from "@/lib/config";
import { createCampaign, getCampaigns } from "@/lib/repositories/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/auth";
import { campaignInputSchema, validationMessage } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ campaigns: isDemoMode ? [] : await getCampaigns(user.id) });
  } catch (error) {
    return apiError(error, "Unable to load campaigns.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = campaignInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 422 });
    }

    if (isDemoMode) {
      return NextResponse.json({
        campaign: {
          id: randomUUID(),
          ...parsed.data,
          total: parsed.data.leadIds.length,
          queued: parsed.data.leadIds.length,
          sent: 0,
          replied: 0,
          failed: 0,
          status: "scheduled",
          createdAt: new Date().toISOString(),
        },
      });
    }

    const admin = createAdminClient();
    const { data: gmail } = await admin
      .from("gmail_connections")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!gmail) {
      return NextResponse.json({ error: "Connect Gmail before scheduling a campaign." }, { status: 409 });
    }

    return NextResponse.json(
      { campaign: await createCampaign(user.id, parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error, "Unable to create the campaign.");
  }
}
