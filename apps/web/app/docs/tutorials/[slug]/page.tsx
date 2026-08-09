import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TUTORIALS, getTutorialMeta, readTutorialMarkdown, withResolvedHost } from "@/lib/brain/tutorial-content";
import { resolvePublicWebUrl } from "@/lib/brain/public-urls";
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

// public-urls.ts's own contract: any caller of resolvePublicWebUrl() must opt
// out of static rendering, or a Docker build's dummy env freezes an empty
// host into the page forever (#293). The root layout's cookies() read
// already forces this app-wide today, but this page shouldn't depend on that
// incidental fact — it has its own reason to need the directive.
export const dynamic = "force-dynamic";

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

  // <your-brain> → this deployment's real host, resolved at request time
  // (see withResolvedHost's doc comment for why build time is wrong here).
  const webUrl = resolvePublicWebUrl();
  const resolve = (c: string | null) => (c === null ? null : withResolvedHost(c, webUrl));

  return (
    <TutorialView
      meta={meta}
      content={{
        en: withResolvedHost(en.content, webUrl),
        th: resolve(th?.content ?? null),
        de: resolve(de?.content ?? null),
      }}
      translated={{ en: true, th: th?.isTranslated ?? false, de: de?.isTranslated ?? false }}
    />
  );
}
