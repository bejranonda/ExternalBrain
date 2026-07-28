const publicHostname = process.env.PUBLIC_HOSTNAME ?? 'localhost';

export default function Page() {
  return (
    <main>
      <h1>{publicHostname}</h1>
    </main>
  );
}
