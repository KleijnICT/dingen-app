import { useT } from '../i18n/index.js'
import { reloadForUpdate, useUpdateAvailable } from '../pwa.js'

/** A small bar that appears when a new version of the app is ready. */
export function UpdateNotice() {
  const t = useT()
  if (!useUpdateAvailable()) return null
  return (
    <div className="update-notice" role="status">
      <span>{t('pwa.updateAvailable')}</span>
      <button type="button" onClick={reloadForUpdate}>
        {t('pwa.reload')}
      </button>
    </div>
  )
}
