'use client';

import { useEffect, useState } from 'react';

export function HostnameBadge() {
  // window is undefined during SSR and on the hydration pass, so the hostname
  // is read in an effect — reading it during render would desync the markup.
  const [hostname, setHostname] = useState<string | null>(null);

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  if (hostname === null) return null;

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        border: '1px solid currentColor',
        fontSize: '0.75rem',
        lineHeight: 1.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {hostname}
    </span>
  );
}

export default HostnameBadge;
