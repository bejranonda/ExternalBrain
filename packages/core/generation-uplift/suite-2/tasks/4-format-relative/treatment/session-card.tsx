'use client';

import { useEffect, useState } from 'react';
import { formatRelative } from '@brain/core/format-relative';

const ABSOLUTE = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatAbsolute(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : ABSOLUTE.format(date);
}

interface RelativeTimeProps {
  iso: string;
  className?: string;
}

export function RelativeTime({ iso, className }: RelativeTimeProps) {
  const absolute = formatAbsolute(iso);
  const [label, setLabel] = useState(absolute);

  useEffect(() => {
    setLabel(formatRelative(iso));
  }, [iso]);

  return (
    <time dateTime={iso} title={absolute} className={className}>
      {label}
    </time>
  );
}

export interface SessionCardProps {
  title: string;
  updatedAt: string;
  className?: string;
}

export function SessionCard({ title, updatedAt, className }: SessionCardProps) {
  return (
    <article className={className}>
      <h3>{title}</h3>
      <RelativeTime iso={updatedAt} />
    </article>
  );
}

export default SessionCard;
