const TOKEN_PATTERN = /\{\{?\s*(name|company|role|location)\s*\}?\}/gi;

export interface TemplateValues {
  name?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
}

export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(TOKEN_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase() as keyof TemplateValues;
    const value = values[key]?.trim();

    if (value) return value;
    if (key === "name") return "there";
    if (key === "company") return "your team";
    if (key === "role") return "email design";
    return "your region";
  });
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

