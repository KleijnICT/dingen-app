import { useT } from '../i18n/index.js'
import { reloadForUpdate, useOutdated, useUpdateAvailable } from '../pwa.js'

/**
 * A small bar that appears when a new version of the app is ready, or when the
 * server needs a newer one and reloading by itself did not bring it.
 */
export function UpdateNotice() {
  const t = useT()
  const available = useUpdateAvailable()
  const outdated = useOutdated()
  if (!available && !outdated) return null
  return (
    <div className="update-notice" role="status">
      <span>{t(outdated ? 'pwa.outdated' : 'pwa.updateAvailable')}</span>
      <button type="button" className="button-primary" onClick={reloadForUpdate}>
        {t('pwa.reload')}
      </button>
    </div>
  )
}
