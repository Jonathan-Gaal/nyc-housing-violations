import { getPool } from '@/lib/pgClient';
import { getPaginatedBuildingsForZip } from '@/lib/queries';
import { validateZipCode } from '@/lib/validation';

const PAGE_SIZE = 20;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get('zip');
  const requestedPage = Number(searchParams.get('page'));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const validation = validateZipCode(zip);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const pool = getPool();
    const result = await getPaginatedBuildingsForZip(pool, zip as string, page, PAGE_SIZE);
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
