import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { isDemoMode } from "@/lib/config";
import { isPdfBytes } from "@/lib/pdf";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";

const MAX_CV_SIZE = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a PDF CV to upload." }, { status: 422 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF CV files are accepted." }, { status: 422 });
    }
    if (file.size <= 0 || file.size > MAX_CV_SIZE) {
      return NextResponse.json({ error: "The CV must be between 1 byte and 10 MB." }, { status: 422 });
    }
    if (!isPdfBytes(new Uint8Array(await file.slice(0, 5).arrayBuffer()))) {
      return NextResponse.json(
        {
          error:
            "That file is not a real PDF. Open it and use Save as / Export as PDF, then upload again.",
        },
        { status: 422 },
      );
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "cv.pdf";
    const path = `${user.id}/${Date.now()}-${safeName}`;
    if (!isDemoMode) {
      const supabase = await createClient();
      const { error } = await supabase.storage.from("cvs").upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ path, name: safeName });
  } catch (error) {
    return apiError(error, "Unable to upload the CV.");
  }
}
