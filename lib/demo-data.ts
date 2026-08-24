import type { Campaign, Lead, SearchInput } from "@/lib/types";

const NOW = "2026-08-24T08:00:00.000Z";

export const DEMO_LEADS: Lead[] = [
  {
    id: "1f188f84-1737-4eb7-93b7-10dc5cb52fb0",
    kind: "agency",
    name: "Anisha Shrestha",
    company: "Lotus Letter Studio",
    role: "Creative Director",
    email: "hello@lotusletter.example",
    location: "Lalitpur, Nepal",
    country: "Nepal",
    websiteUrl: "https://lotusletter.example",
    linkedinUrl: "https://linkedin.com/company/lotus-letter-studio",
    instagramUrl: null,
    facebookUrl: null,
    sourceUrl: "https://lotusletter.example/contact",
    sourceType: "web",
    confidence: 96,
    status: "approved",
    emailPublic: true,
    evidence: "Published on the studio contact page.",
    createdAt: NOW,
  },
  {
    id: "7e19be7a-7643-48fb-a536-cd933b059505",
    kind: "person",
    name: "Rohan Karki",
    company: "MailMandu",
    role: "Email Designer",
    email: "rohan@mailmandu.example",
    location: "Kathmandu, Nepal",
    country: "Nepal",
    websiteUrl: "https://mailmandu.example",
    linkedinUrl: "https://linkedin.com/in/rohan-karki-email",
    instagramUrl: null,
    facebookUrl: null,
    sourceUrl: "https://mailmandu.example/team",
    sourceType: "linkedin",
    confidence: 91,
    status: "new",
    emailPublic: true,
    evidence: "Public team biography and portfolio contact link.",
    createdAt: NOW,
  },
  {
    id: "30fd1306-b95c-4afe-9523-ac36c51fb62d",
    kind: "agency",
    name: "Maya Chen",
    company: "Flow & Fold",
    role: "Head of Design",
    email: "careers@flowandfold.example",
    location: "Melbourne, Australia",
    country: "Australia",
    websiteUrl: "https://flowandfold.example",
    linkedinUrl: "https://linkedin.com/company/flow-and-fold",
    instagramUrl: "https://instagram.com/flowandfold",
    facebookUrl: null,
    sourceUrl: "https://flowandfold.example/careers",
    sourceType: "instagram",
    confidence: 94,
    status: "approved",
    emailPublic: true,
    evidence: "Careers mailbox published on the official website.",
    createdAt: NOW,
  },
  {
    id: "a46fffa5-0f23-4476-9656-20fea15b95fc",
    kind: "agency",
    name: "Jordan Miles",
    company: "Sendwell Creative",
    role: "Design Lead",
    email: "jobs@sendwell.example",
    location: "Austin, United States",
    country: "United States",
    websiteUrl: "https://sendwell.example",
    linkedinUrl: "https://linkedin.com/company/sendwell-creative",
    instagramUrl: null,
    facebookUrl: "https://facebook.com/sendwellcreative",
    sourceUrl: "https://sendwell.example/jobs",
    sourceType: "facebook",
    confidence: 89,
    status: "new",
    emailPublic: true,
    evidence: "Jobs address listed on the agency hiring page.",
    createdAt: NOW,
  },
  {
    id: "c28130ed-e3e1-4ae3-86d5-41a9a01ac8e8",
    kind: "person",
    name: "Sofia Bennett",
    company: "Retention Room",
    role: "Senior Email Designer",
    email: "sofia@retentionroom.example",
    location: "London, United Kingdom",
    country: "United Kingdom",
    websiteUrl: "https://retentionroom.example",
    linkedinUrl: "https://linkedin.com/in/sofia-bennett-design",
    instagramUrl: null,
    facebookUrl: null,
    sourceUrl: "https://retentionroom.example/about",
    sourceType: "web",
    confidence: 87,
    status: "contacted",
    emailPublic: true,
    evidence: "Email published next to the team member profile.",
    createdAt: NOW,
  },
  {
    id: "ea985f1b-91d6-455f-bf83-99f2d8ed581a",
    kind: "agency",
    name: "The Letter Lab",
    company: "The Letter Lab",
    role: "Email marketing agency",
    email: null,
    location: "Toronto, Canada",
    country: "Canada",
    websiteUrl: "https://letterlab.example",
    linkedinUrl: "https://linkedin.com/company/the-letter-lab",
    instagramUrl: "https://instagram.com/theletterlab",
    facebookUrl: null,
    sourceUrl: "https://linkedin.com/company/the-letter-lab",
    sourceType: "linkedin",
    confidence: 54,
    status: "new",
    emailPublic: false,
    evidence: "Public profile found; no published email located yet.",
    createdAt: NOW,
  },
];

export const DEMO_CAMPAIGNS: Campaign[] = [
  {
    id: "01989d67-b2f9-76c1-b514-9aac09c82f63",
    name: "August portfolio outreach",
    subjectTemplate: "Email designer application for {{company}}",
    bodyTemplate:
      "Hi {{name}},\n\nI admire the email work coming from {{company}}. I am an email designer based in Nepal and would love to contribute to your team. I have attached my CV for consideration.\n\nBest,\nYour name",
    cvPath: "demo/inboxscout-cv.pdf",
    dailyLimit: 12,
    sendTimezone: "Asia/Kathmandu",
    sendStart: "09:00",
    sendEnd: "17:00",
    status: "scheduled",
    scheduledAt: "2026-08-25T03:15:00.000Z",
    total: 8,
    queued: 5,
    sent: 3,
    replied: 1,
    failed: 0,
    createdAt: NOW,
  },
];

export function searchDemoLeads(input: SearchInput): Lead[] {
  let results = [...DEMO_LEADS];

  if (input.regionMode === "nepal") {
    results = results.filter((lead) => lead.country === "Nepal");
  } else if (input.regionMode === "international") {
    results = results.filter((lead) => lead.country !== "Nepal");
  }

  if (input.sources.length) {
    results = results.filter((lead) => input.sources.includes(lead.sourceType));
  }

  if (input.leadType !== "all") {
    results = results.filter((lead) => lead.kind === input.leadType);
  }

  const terms = [input.query, ...input.roles, ...input.countries, ...input.cities]
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2);

  if (terms.length) {
    const matched = results.filter((lead) => {
      const haystack = [lead.name, lead.company, lead.role, lead.location, lead.country]
        .join(" ")
        .toLowerCase();
      return terms.some((term) => haystack.includes(term));
    });
    if (matched.length) results = matched;
  }

  return results;
}
