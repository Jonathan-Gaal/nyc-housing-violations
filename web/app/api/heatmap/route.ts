import { getPool } from '@/lib/pgClient';
import { getHeatmapPoints } from '@/lib/queries';
import { validateZipCode } from '@/lib/validation';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get('zip');

  const validation = validateZipCode(zip);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const pool = getPool();
    const points = await getHeatmapPoints(pool, zip as string);
    return Response.json({ points });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
