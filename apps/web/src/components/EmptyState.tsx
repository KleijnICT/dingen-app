/**
 * The one empty state: a short title and one sentence, both muted. No pictures and no
 * buttons that repeat what the toolbar already offers. Not for loading or errors.
 */
export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
    </div>
  )
}
