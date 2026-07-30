'use client';

import { useEffect, useState } from 'react';
import { formatRelative } from '@brain/core/format-relative';

interface RelativeTimeProps {
  iso: string;
}

/**
 * Relative time is computed from `Date.now()`, which differs between the
 * server render and the client hydration pass. Render the stable absolute
 * date first and swap to the relative label after mount.
 */
function RelativeTime({ iso }: RelativeTimeProps) {
  const [label, setLabel] = useState(() => absoluteDate(iso));

  useEffect(() => {
    setLabel(formatRelative(iso));
  }, [iso]);

  return (
    <time dateTime={iso} title={iso}>
      {label}
    </time>
  );
}

function absoluteDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toISOString().slice(0, 10);
}

export interface SessionCardProps {
  title: string;
  updatedAt: string;
}

export function SessionCard({ title, updatedAt }: SessionCardProps) {
  return (
    <article className="session-card">
      <h3 className="session-card__title">{title}</h3>
      <p className="session-card__meta">
        <RelativeTime iso={updatedAt} />
      </p>
    </article>
  );
}

export default SessionCard;
