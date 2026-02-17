'use client';

import type { ArticleMetaProps as P } from '@/lib/vsl/runtime/types';

export function ArticleMeta(props: P) {
  const {
    authorName,
    updatedText,
    authorColor = '#374151',
    metaColor = '#6b7280',
    layout = 'stack',
  } = props;

  if (!authorName && !updatedText) return null;

  const stack = layout === 'stack';

  return (
    <div className={`text-sm ${stack ? 'space-y-0.5' : 'flex flex-wrap items-center gap-x-2 gap-y-0.5'}`}>
      {authorName && (
        <span style={{ color: authorColor }}>
          Por {authorName}
        </span>
      )}
      {updatedText && (
        <span style={{ color: metaColor }} className={stack ? 'block' : ''}>
          {updatedText}
        </span>
      )}
    </div>
  );
}
