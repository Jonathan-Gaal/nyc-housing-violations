// examples/api-route-typed.ts
// Production-grade API route with type safety and error handling
// Pattern: Zod validation, typed responses, error handling
// Reference: SKILL.md "Pattern 2: Zod Validation" + "Pattern 6: Error Handling"

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import type { NextRequest } from 'next/server';

// ============================================================================
// TYPES & VALIDATION
// ============================================================================

// Request schema
const CreatePostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  content: z.string().min(1, 'Content is required').max(10000, 'Content too long'),
  tags: z.array(z.string()).max(5, 'Max 5 tags').default([]),
  published: z.boolean().default(false),
});

type CreatePostInput = z.infer<typeof CreatePostSchema>;

// Response types
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; issues?: z.ZodIssue[] };

type PostResponse = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  published: boolean;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Error responses
type ErrorResponse = ApiResponse<never>;

// ============================================================================
// POST — Create a new post
// ============================================================================

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // 1. Authentication check
    const session = await auth();
    if (!session?.user?.id) {
      const response: ErrorResponse = {
        success: false,
        error: 'Unauthorized',
      };
      return Response.json(response, { status: 401 });
    }

    // 2. Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      const response: ErrorResponse = {
        success: false,
        error: 'Invalid JSON',
      };
      return Response.json(response, { status: 400 });
    }

    // 3. Validate input
    const parsed = CreatePostSchema.safeParse(body);
    if (!parsed.success) {
      const response: ErrorResponse = {
        success: false,
        error: 'Validation failed',
        issues: parsed.error.issues,
      };
      return Response.json(response, { status: 400 });
    }

    // 4. Check authorization (user can only create their own posts)
    const userId = session.user.id;

    // 5. Create in database
    const post = await db.post.create({
      data: {
        title: parsed.data.title,
        content: parsed.data.content,
        tags: parsed.data.tags,
        published: parsed.data.published,
        authorId: userId,
      },
      select: {
        id: true,
        title: true,
        content: true,
        tags: true,
        published: true,
        authorId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 6. Return success response
    const response: ApiResponse<PostResponse> = {
      success: true,
      data: post,
    };
    return Response.json(response, { status: 201 });
  } catch (error) {
    console.error('[POST /api/posts] Error:', error);

    // Don't expose internal errors to client
    const response: ErrorResponse = {
      success: false,
      error: 'Failed to create post',
    };
    return Response.json(response, { status: 500 });
  }
}

// ============================================================================
// GET — Fetch posts (public or user-specific)
// ============================================================================

interface GetPostsQuery {
  authorId?: string;
  published?: boolean;
  limit?: number;
  offset?: number;
}

const GetPostsSchema = z.object({
  authorId: z.string().uuid().optional(),
  published: z.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(10),
  offset: z.coerce.number().min(0).default(0),
});

type GetPostsResponse = {
  posts: PostResponse[];
  total: number;
  limit: number;
  offset: number;
};

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // 1. Parse query params
    const searchParams = request.nextUrl.searchParams;
    const query = Object.fromEntries(searchParams.entries());

    // 2. Validate query
    const parsed = GetPostsSchema.safeParse(query);
    if (!parsed.success) {
      const response: ErrorResponse = {
        success: false,
        error: 'Invalid query parameters',
        issues: parsed.error.issues,
      };
      return Response.json(response, { status: 400 });
    }

    // 3. Build database query
    const where: any = {};
    if (parsed.data.authorId) {
      where.authorId = parsed.data.authorId;
    }
    // Only show published posts to public users
    const session = await auth();
    if (!session?.user?.id) {
      where.published = true;
    }

    // 4. Fetch posts and count
    const [posts, total] = await Promise.all([
      db.post.findMany({
        where,
        select: {
          id: true,
          title: true,
          content: true,
          tags: true,
          published: true,
          authorId: true,
          createdAt: true,
          updatedAt: true,
        },
        skip: parsed.data.offset,
        take: parsed.data.limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.post.count({ where }),
    ]);

    // 5. Return success response
    const response: ApiResponse<GetPostsResponse> = {
      success: true,
      data: {
        posts,
        total,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      },
    };
    return Response.json(response);
  } catch (error) {
    console.error('[GET /api/posts] Error:', error);

    const response: ErrorResponse = {
      success: false,
      error: 'Failed to fetch posts',
    };
    return Response.json(response, { status: 500 });
  }
}

// ============================================================================
// BEST PRACTICES DEMONSTRATED
// ============================================================================

// ✅ Authentication: Check session before allowing mutations
// ✅ Validation: Use Zod to validate all external input
// ✅ Type safety: Use inferred types from schemas
// ✅ Error handling: Return typed, structured error responses
// ✅ Security: Don't expose internal errors to client
// ✅ Database: Use parameterized queries (Prisma handles this)
// ✅ Authorization: Verify user owns the resource they're modifying
// ✅ Query safety: Validate and limit pagination parameters
// ✅ Logging: Log errors for debugging (not exposed to client)
// ✅ Response structure: Consistent success/error format
