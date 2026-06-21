import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { DOCS, asLang, getDoc } from "@/lib/brain/docs-content";
import { ConceptView } from "./concept-view";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  // Localize the document title/description from the bp_lang cookie (per-slug
  // EN fallback inside getDoc), matching the body language. #59.
  const lang = asLang((await cookies()).get("bp_lang")?.value);
  const page = getDoc(lang, slug);
  if (!page) return { title: "Not found — Documentation" };
  return {
    title: `${page.title} — External Brain docs`,
    description: page.summary,
  };
}

export function generateStaticParams() {
  // DOCS is the canonical slug set; TH/DE mirror the same slugs.
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export default async function ConceptPage({ params }: Params) {
  const { slug } = await params;
  // Validate against the canonical EN registry; the client view resolves the
  // localized copy (with EN fallback) from the active locale.
  if (!DOCS[slug]) notFound();
  return <ConceptView slug={slug} />;
}
