// templates/new-api-route.ts
// Template: Type-safe API route
// Copy this to app/api/[route]/route.ts and adapt

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import type { NextRequest } from 'next/server';

// ============================================================================
// TYPES & VALIDATION
// ============================================================================

const RequestSchema = z.object({
  // Define your request body schema
  name: z.string().min(1).max(100),
  email: z.string().email(),
  // Add more fields...
});

type RequestBody = z.infer<typeof RequestSchema>;

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; issues?: z.ZodIssue[] };

interface ResponseData {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  // Add more fields...
}

// ============================================================================
// GET — Fetch resource(s)
// ============================================================================

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // 1. Authentication
    const session = await auth();
    if (!session?.user?.id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Unauthorized',
      };
      return Response.json(response, { status: 401 });
    }

    // 2. Parse query parameters (optional)
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

    // 3. Fetch from database
    const data = await db.something.findMany({
      where: {
        userId: session.user.id,
      },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });

    // 4. Return response
    const response: ApiResponse<ResponseData[]> = {
      success: true,
      data: data as ResponseData[],
    };
    return Response.json(response);
  } catch (error) {
    console.error('[GET] Error:', error);
    const response: ApiResponse<never> = {
      success: false,
      error: 'Failed to fetch resource',
    };
    return Response.json(response, { status: 500 });
  }
}

// ============================================================================
// POST — Create resource
// ============================================================================

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // 1. Authentication
    const session = await auth();
    if (!session?.user?.id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Unauthorized',
      };
      return Response.json(response, { status: 401 });
    }

    // 2. Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Invalid JSON',
      };
      return Response.json(response, { status: 400 });
    }

    // 3. Validate
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Validation failed',
        issues: parsed.error.issues,
      };
      return Response.json(response, { status: 400 });
    }

    // 4. Create in database
    const created = await db.something.create({
      data: {
        ...parsed.data,
        userId: session.user.id,
      },
    });

    // 5. Return response
    const response: ApiResponse<ResponseData> = {
      success: true,
      data: created as ResponseData,
    };
    return Response.json(response, { status: 201 });
  } catch (error) {
    console.error('[POST] Error:', error);
    const response: ApiResponse<never> = {
      success: false,
      error: 'Failed to create resource',
    };
    return Response.json(response, { status: 500 });
  }
}

// ============================================================================
// PATCH — Update resource
// ============================================================================

/*
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    // 1. Authentication
    const session = await auth();
    if (!session?.user?.id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Unauthorized',
      };
      return Response.json(response, { status: 401 });
    }

    // 2. Get ID from URL
    const { pathname } = request.nextUrl;
    const id = pathname.split('/').pop();
    if (!id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'ID required',
      };
      return Response.json(response, { status: 400 });
    }

    // 3. Parse body
    const body = await request.json();
    const parsed = RequestSchema.partial().safeParse(body);
    if (!parsed.success) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Validation failed',
        issues: parsed.error.issues,
      };
      return Response.json(response, { status: 400 });
    }

    // 4. Update (verify ownership)
    const item = await db.something.findUnique({ where: { id } });
    if (!item || item.userId !== session.user.id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Not found or unauthorized',
      };
      return Response.json(response, { status: 404 });
    }

    const updated = await db.something.update({
      where: { id },
      data: parsed.data,
    });

    // 5. Return response
    const response: ApiResponse<ResponseData> = {
      success: true,
      data: updated as ResponseData,
    };
    return Response.json(response);
  } catch (error) {
    console.error('[PATCH] Error:', error);
    const response: ApiResponse<never> = {
      success: false,
      error: 'Failed to update resource',
    };
    return Response.json(response, { status: 500 });
  }
}
*/

// ============================================================================
// DELETE — Delete resource
// ============================================================================

/*
export async function DELETE(request: NextRequest): Promise<Response> {
  try {
    // 1. Authentication
    const session = await auth();
    if (!session?.user?.id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Unauthorized',
      };
      return Response.json(response, { status: 401 });
    }

    // 2. Get ID
    const { pathname } = request.nextUrl;
    const id = pathname.split('/').pop();
    if (!id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'ID required',
      };
      return Response.json(response, { status: 400 });
    }

    // 3. Verify ownership and delete
    const item = await db.something.findUnique({ where: { id } });
    if (!item || item.userId !== session.user.id) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Not found or unauthorized',
      };
      return Response.json(response, { status: 404 });
    }

    await db.something.delete({ where: { id } });

    // 4. Return response
    const response: ApiResponse<{ deleted: true }> = {
      success: true,
      data: { deleted: true },
    };
    return Response.json(response);
  } catch (error) {
    console.error('[DELETE] Error:', error);
    const response: ApiResponse<never> = {
      success: false,
      error: 'Failed to delete resource',
    };
    return Response.json(response, { status: 500 });
  }
}
*/

// ============================================================================
// BEST PRACTICES
// ============================================================================

// ✅ Authentication: Check session before any operation
// ✅ Validation: Use Zod for all inputs
// ✅ Error handling: Try/catch with meaningful messages
// ✅ Type safety: Typed request/response
// ✅ Authorization: Verify user owns the resource
// ✅ Proper HTTP status: 201 for create, 404 for not found
// ✅ Structured responses: Consistent success/error format
// ✅ Logging: Errors logged for debugging
// ✅ Security: No secret leaks, parameterized queries
// ✅ Scalability: Pagination with limit/offset
