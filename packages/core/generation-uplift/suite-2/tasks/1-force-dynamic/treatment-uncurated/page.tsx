// Read at request time, not build time: the Docker image is built once and run
// against many environments, so a prerendered/inlined PUBLIC_HOSTNAME would be
// baked in as whatever the builder happened to have (usually undefined).
export const dynamic = "force-dynamic";

export default function Page() {
  const publicHostname = process.env.PUBLIC_HOSTNAME ?? "";

  return <h1>{publicHostname}</h1>;
}
