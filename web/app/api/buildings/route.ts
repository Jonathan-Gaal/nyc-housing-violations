import { getPool } from '@/lib/pgClient';
import { getZipSummaryAndTopBuildings } from '@/lib/queries';
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
    const { summary, topBuildings } = await getZipSummaryAndTopBuildings(pool, zip as string);
    return Response.json({ summary, topBuildings });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
