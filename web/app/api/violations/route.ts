import { getDb } from '@/lib/db';
import { getViolationsForBuilding } from '@/lib/queries';
import { validateBuildingId } from '@/lib/validation';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const buildingId = searchParams.get('buildingId');

  const validation = validateBuildingId(buildingId);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const db = getDb();
    const violations = getViolationsForBuilding(db, buildingId as string);
    return Response.json({ violations });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
