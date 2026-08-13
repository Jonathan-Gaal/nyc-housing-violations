// templates/new-page.tsx
// Template: Server page component
// Copy this to app/[route]/page.tsx and adapt

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

// ============================================================================
// METADATA
// ============================================================================

export const metadata: Metadata = {
  title: 'Page Title',
  description: 'Page description for SEO',
  keywords: ['keyword1', 'keyword2'],
};

// ============================================================================
// PAGE COMPONENT (Server Component by default)
// ============================================================================

interface PageProps {
  params: {
    id: string;
  };
  searchParams: {
    sort?: string;
    filter?: string;
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  // 1. Authentication check (if needed)
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  try {
    // 2. Fetch data server-side
    const data = await db.something.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 3. Render
    return (
      <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold mb-6">Page Title</h1>

        {data.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600">No data found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.map((item) => (
              <div key={item.id} className="border rounded-lg p-4">
                {/* Render items */}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } catch (error) {
    console.error('[PAGE] Error:', error);
    throw error; // Let error.tsx handle it
  }
}

// ============================================================================
// STATIC GENERATION (if applicable)
// ============================================================================

/*
// Generate static pages at build time
export async function generateStaticParams() {
  const items = await db.something.findMany({
    select: { id: true },
  });

  return items.map((item) => ({
    id: item.id,
  }));
}

// Revalidate every hour (ISR)
export const revalidate = 3600;
*/

// ============================================================================
// NOTES
// ============================================================================

// ✅ This is a server component (default)
// ✅ Fetch data directly from database
// ✅ Authentication happens server-side
// ✅ No secrets exposed to client
// ✅ Use redirect() for auth checks (server-side)
// ✅ Metadata for SEO
// ✅ Error handling with try/catch
// ✅ Empty state handling
// ✅ Use optional: ISR for better performance
