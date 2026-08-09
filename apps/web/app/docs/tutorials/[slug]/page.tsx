import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TUTORIALS, getTutorialMeta, readTutorialMarkdown } from "@/lib/brain/tutorial-content";
import { TutorialView } from "./tutorial-view";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const meta = getTutorialMeta(slug);
  if (!meta) return { title: "Not found — Documentation" };
  return {
    title: `${meta.title} — External Brain tutorials`,
    description: meta.summary,
  };
}

export function generateStaticParams() {
  return TUTORIALS.map((t) => ({ slug: t.slug }));
}

export default async function TutorialPage({ params }: Params) {
  const { slug } = await params;
  const meta = getTutorialMeta(slug);
  if (!meta) notFound();

  // Read at build time in every language up front — SSG prerenders each
  // locale's markdown once, so the client component never needs to read
  // files itself (it can't; readTutorialMarkdown is Node-only). The client
  // view picks the right one via useLang() and re-renders only the choice,
  // not a fetch.
  const en = readTutorialMarkdown("en", slug);
  const th = readTutorialMarkdown("th", slug);
  const de = readTutorialMarkdown("de", slug);
  if (!en) notFound();

  return (
    <TutorialView
      meta={meta}
      content={{ en: en.content, th: th?.content ?? null, de: de?.content ?? null }}
      translated={{ en: true, th: th?.isTranslated ?? false, de: de?.isTranslated ?? false }}
    />
  );
}
