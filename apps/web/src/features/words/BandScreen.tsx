// Placeholder from F6. The owning feature package replaces it and keeps the export name.
import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../../app/Placeholder';
import { t } from '../../messages';

export function BandScreen() {
  const { band } = useParams({ strict: false });
  return <Placeholder title={t('screens.band')} params={{ band: String(band) }} />;
}
