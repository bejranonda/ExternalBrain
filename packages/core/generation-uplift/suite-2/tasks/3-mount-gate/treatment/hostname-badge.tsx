'use client';

import { useEffect, useState } from 'react';

export function HostnameBadge() {
  const [hostname, setHostname] = useState<string | null>(null);

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  return (
    <span className="inline-flex items-center rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
      {hostname ?? '—'}
    </span>
  );
}
