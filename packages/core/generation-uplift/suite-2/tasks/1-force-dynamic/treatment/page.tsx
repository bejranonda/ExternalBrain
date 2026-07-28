// Without force-dynamic, Next would prerender this page at `next build` — inside
// the Docker image build, where PUBLIC_HOSTNAME is not the runtime value — and
// bake the wrong hostname into the static HTML.
export const dynamic = "force-dynamic";

const publicHostname = process.env.PUBLIC_HOSTNAME ?? "";

export default function Page() {
  return <h1>{publicHostname}</h1>;
}
