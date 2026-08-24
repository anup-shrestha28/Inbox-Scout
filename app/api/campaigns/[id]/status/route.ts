import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { isDemoMode } from "@/lib/config";
import { setCampaignStatus } from "@/lib/repositories/campaigns";
import { requireUser } from "@/lib/supabase/auth";

const schema = z.object({ status: z.enum(["scheduled", "paused"]) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ error: "Invalid campaign identifier." }, { status: 422 });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid campaign status." }, { status: 422 });
    }
    if (!isDemoMode) await setCampaignStatus(user.id, id, parsed.data.status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update the campaign.");
  }
}

