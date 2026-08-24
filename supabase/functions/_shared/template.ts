const TOKEN_PATTERN = /\{\{?\s*(name|company|role|location)\s*\}?\}/gi;

export function renderTemplate(
  template: string,
  values: Record<"name" | "company" | "role" | "location", string | null>,
): string {
  return template.replace(TOKEN_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase() as keyof typeof values;
    if (values[key]?.trim()) return values[key]!.trim();
    if (key === "name") return "there";
    if (key === "company") return "your team";
    if (key === "role") return "email design";
    return "your region";
  });
}

