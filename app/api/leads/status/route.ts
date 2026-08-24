import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { isDemoMode } from "@/lib/config";
import { updateLeadStatuses } from "@/lib/repositories/leads";
import { requireUser } from "@/lib/supabase/auth";
import { leadStatusSchema, validationMessage } from "@/lib/validation";

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const parsed = leadStatusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 422 });
    }
    if (!isDemoMode) {
      await updateLeadStatuses(user.id, parsed.data.ids, parsed.data.status);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update leads.");
  }
}

