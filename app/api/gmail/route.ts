import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { isDemoMode } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/auth";

export async function DELETE() {
  try {
    const user = await requireUser();
    if (!isDemoMode) {
      const admin = createAdminClient();
      const { error } = await admin.from("gmail_connections").delete().eq("user_id", user.id);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to disconnect Gmail.");
  }
}
