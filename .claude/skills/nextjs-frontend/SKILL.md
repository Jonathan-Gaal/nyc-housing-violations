---
name: nextjs-frontend
description: Reference patterns, hard rules, and verification oracle for production-grade Next.js 14+ App Router fullstack apps (server components, Zod validation, HttpOnly auth cookies, parameterized queries, Tailwind, testing/deploy checklists). Use when writing, reviewing, or scaffolding Next.js pages, API routes, or database code.
---

# Next.js Enterprise Fullstack Skill

**Scope:** Production-grade Next.js 14+ applications (frontend + backend)  
**Level:** Enterprise / Professional  
**Version:** 1.0  
**Last Updated:** 2026-08-04  
**Status:** Active Reference  

---

## PURPOSE

This skill defines patterns and best practices for building **fullstack web applications** using Next.js 14+ (App Router). It covers:

- Frontend: Pages, components, styling, client-side state
- Backend: API routes, database integration, server-side logic
- Integration: Full-stack data flow, security boundaries
- DevOps: Deployment, monitoring, performance

**This skill is not prescriptive decoration.** Every pattern exists because it solves a real problem at scale. Violations are permitted, but require explicit reasoning and approval.

---

## PATTERN ENFORCEMENT POLICY

### When Patterns Apply

**Always follow patterns unless:**
1. You have measured evidence that the pattern is causing a problem
2. You can articulate a specific, concrete reason to deviate
3. You have run this reasoning by the human for approval
4. You document the override in the codebase and log

**Example of valid override reasoning:**
```
Pattern: Use server components by default; client only when needed
Deviation: Entire dashboard is a client component
Reasoning: The dashboard needs real-time updates via WebSocket. 
Server components cannot subscribe to external events. 
Trade-off: Accept client-side rendering cost for real-time capability.
Approved: 2026-08-04 by Jon
Documented in: app/dashboard/README.md
```

**Example of invalid reasoning:**
```
Pattern: Validate all external input with Zod
Deviation: Skipping validation on this API route
Reasoning: "It's just internal use, no one will exploit it"
Status: REJECTED — Internal APIs are exploited frequently.
         Validation cost is negligible.
```

### Approval Workflow

**When deviating from a pattern:**

1. **Identify the pattern** you're breaking (cite this SKILL.md)
2. **State the reason** (be specific; "it's simpler" is not a reason)
3. **Log it** in your code comments or documentation
4. **Get approval** from Jon before committing
5. **Document the trade-off** so future developers understand why

**In code:**
```typescript
// PATTERN OVERRIDE: Using client component for dashboard
// REASON: Real-time WebSocket updates require client-side state
// APPROVED: 2026-08-04
// See: app/dashboard/README.md for detailed justification
'use client';

export default function Dashboard() {
  // ...
}
```

---

## CORE PRINCIPLES

### 1. Server-First Architecture

- **Default to server components**
- Client components only when user interaction or browser APIs are needed
- Fetch data server-side; pass as props
- Secrets stay on the server; never leak to browser

### 2. Type Safety Everywhere

- TypeScript `strict: true` (no `any`)
- Zod for all external input validation
- Infer types from validators, not the other way around
- All API responses typed and validated

### 3. Security is Non-Negotiable

- Validate every external input
- HttpOnly cookies for auth (never localStorage)
- Parameterized queries (never string concatenation)
- Sanitize user-generated HTML
- CSRF protection on all state mutations

### 4. Performance is Measured

- LCP < 2.5s, FID < 100ms, CLS < 0.1
- Images optimized with `next/image`
- Code-split and lazy-load heavy components
- Cache strategically (ISR, React Query, browser cache)
- Monitor with real user metrics

### 5. Testing is Required

- Unit tests for logic (Jest + RTL)
- Integration tests for API routes
- E2E tests for critical user flows (Playwright)
- Minimum 80% coverage for critical paths

### 6. Simplicity > Complexity (With Exceptions)

- Start with the simplest solution
- Add patterns only when evidence shows it's needed
- Complex abstractions are tech debt until proven
- **Exception:** For this reference implementation, architectural clarity and teachability override simplicity

---

## ARCHITECTURE AT A GLANCE

### Fullstack Layers

```
┌─────────────────────────────────────────────────────────┐
│ Client Layer (Browser)                                  │
│ ├─ Pages (server components by default)                │
│ ├─ Components (UI, mostly client)                       │
│ ├─ React Query (client-side data fetching)              │
│ └─ Tailwind CSS (styling)                               │
├─────────────────────────────────────────────────────────┤
│ API Layer (server-only, Next.js API routes)             │
│ ├─ Route handlers (POST, GET, etc.)                     │
│ ├─ Middleware (auth, logging, rate limiting)            │
│ ├─ Validation (Zod schemas)                             │
│ └─ Error handling (typed responses)                     │
├─────────────────────────────────────────────────────────┤
│ Data Layer (server-only)                                │
│ ├─ Database (Prisma ORM)                                │
│ ├─ Secrets (env vars, never exposed)                    │
│ ├─ Background jobs (optional)                           │
│ └─ Cache (Redis optional)                               │
└─────────────────────────────────────────────────────────┘
```

### File Structure

```
app/                              # Routes & pages
├── (auth)/                         # Route group (shared layout)
│   ├── layout.tsx
│   ├── login/page.tsx
│   └── signup/page.tsx
├── (dashboard)/
│   ├── layout.tsx
│   ├── page.tsx
│   └── [id]/page.tsx
├── api/                            # API routes (server-only)
│   ├── auth/[...nextauth]/route.ts
│   ├── users/route.ts
│   └── posts/[id]/route.ts
├── layout.tsx                      # Root layout
└── page.tsx                        # Home

components/                       # Reusable components
├── ui/                             # Base UI (button, input, etc.)
├── features/                       # Feature-specific
└── layout/                         # Layout wrappers

lib/                              # Utilities & helpers
├── auth.ts                         # NextAuth config
├── db.ts                           # Prisma client
├── api/                            # API clients
├── validators/                     # Zod schemas
├── hooks/                          # React hooks
└── utils/                          # Pure functions

types/                            # TypeScript types
styles/                           # Global styles
config/                           # Environment, constants
```

---

## KEY PATTERNS (MUST OBSERVE)

### Pattern 1: Server Components by Default

**Rule:** Use server components for pages, layouts, and data-fetching containers.

**When to use:** 
- ✅ Page components
- ✅ Layout wrappers
- ✅ Containers that fetch data
- ✅ Database queries

**When to break:**
- ❌ User interactions (forms, buttons, clicks)
- ❌ React hooks (useState, useEffect)
- ❌ Browser APIs (localStorage, geolocation)
- ❌ Real-time updates

**Example:**
```typescript
// ✅ Server component (default)
export default async function PostsPage() {
  const posts = await db.post.findMany();
  return <PostList posts={posts} />;
}

// ❌ Client component (marked explicitly)
'use client';
export function PostCard({ post }: { post: Post }) {
  const [liked, setLiked] = useState(false);
  return (
    <button onClick={() => setLiked(!liked)}>
      {liked ? 'Liked' : 'Like'}
    </button>
  );
}
```

---

### Pattern 2: Zod Validation for All External Input

**Rule:** Every API input, URL param, and form submission must be validated with Zod.

**When to apply:**
- ✅ API request bodies
- ✅ URL search parameters
- ✅ Form submissions
- ✅ File uploads
- ✅ Webhook payloads

**Example:**
```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Min 8 characters'),
  role: z.enum(['user', 'admin']).default('user'),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

export async function POST(request: Request) {
  const body = await request.json();
  
  // Validate
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  
  // Use validated data
  const user = await db.user.create({ data: parsed.data });
  return Response.json(user);
}
```

---

### Pattern 3: HttpOnly Cookies for Auth

**Rule:** Store session tokens in HttpOnly cookies, never localStorage.

**Why:** HttpOnly cookies cannot be accessed by JavaScript, protecting against XSS attacks.

**Example:**
```typescript
// ✅ Correct: NextAuth.js with HttpOnly cookies
export const { auth, signIn, signOut } = NextAuth({
  providers: [Credentials({ /* ... */ })],
  session: { strategy: 'jwt' },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
  },
});

// ❌ Wrong: Storing in localStorage
localStorage.setItem('token', jwtToken); // VULNERABLE TO XSS
```

---

### Pattern 4: Parameterized Queries

**Rule:** Never concatenate strings into SQL queries. Always use parameterized queries.

**Example:**
```typescript
// ✅ Correct: Parameterized with Prisma
const user = await db.user.findUnique({
  where: { email: userInput },
});

// ✅ Correct: Parameterized raw SQL
const user = await db.$queryRaw`
  SELECT * FROM users WHERE email = ${userInput}
`;

// ❌ Wrong: String concatenation (SQL injection)
const user = await db.$queryRaw(`
  SELECT * FROM users WHERE email = '${userInput}'
`);
```

---

### Pattern 5: Secrets Stay on Server

**Rule:** Never expose secrets to the client. Use `NEXT_PUBLIC_*` only for public data.

**Example:**
```bash
# ✅ Private (server-only)
DATABASE_URL=postgresql://...
API_SECRET=sk_...
JWT_SECRET=...

# ✅ Public (safe in client)
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXT_PUBLIC_ANALYTICS_ID=gtag_...

# ❌ Wrong: Putting secrets in public
NEXT_PUBLIC_API_KEY=sk_... # EXPOSED
```

---

### Pattern 6: Error Handling & Typed Responses

**Rule:** All API responses must be typed and include consistent error structure.

**Example:**
```typescript
// lib/api/types.ts
export type ApiResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string; issues?: any[] };

// app/api/posts/route.ts
export async function GET(request: Request): Promise<Response> {
  try {
    const posts = await db.post.findMany();
    const response: ApiResponse<typeof posts> = {
      success: true,
      data: posts,
    };
    return Response.json(response);
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: 'Failed to fetch posts',
    };
    return Response.json(response, { status: 500 });
  }
}
```

---

### Pattern 7: React Query for Client-Side Data

**Rule:** Use React Query (@tanstack/react-query) for client-side async data.

**Example:**
```typescript
'use client';
import { useQuery } from '@tanstack/react-query';

export function UserProfile() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user'],
    queryFn: () => fetch('/api/user').then(r => r.json()),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorAlert error={error} />;
  return <Profile user={data} />;
}
```

---

### Pattern 8: Middleware for Cross-Cutting Concerns

**Rule:** Use middleware for auth, redirects, and request logging.

**Example:**
```typescript
// middleware.ts
import { auth } from '@/lib/auth';

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};

export async function middleware(request: Request) {
  const session = await auth();
  
  if (!session) {
    return Response.redirect(new URL('/login', request.url));
  }
  
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (session.user.role !== 'admin') {
      return Response.redirect(new URL('/dashboard', request.url));
    }
  }
}
```

---

### Pattern 9: Images with next/image

**Rule:** Always use `next/image` for optimized images.

**Example:**
```typescript
import Image from 'next/image';

export function ProductImage({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={400}
      height={300}
      sizes="(max-width: 768px) 100vw, 50vw"
      priority={false}
      placeholder="blur"
    />
  );
}
```

---

### Pattern 10: Tailwind CSS for Styling

**Rule:** Use Tailwind utility classes. Use CSS modules only for component-scoped styles.

**Example:**
```typescript
// ✅ Tailwind (preferred)
export function Button({ variant }: { variant: 'primary' | 'secondary' }) {
  return (
    <button className={`
      px-4 py-2 rounded font-semibold
      ${variant === 'primary' ? 'bg-blue-600 text-white' : 'bg-gray-200'}
    `}>
      Click me
    </button>
  );
}
```

---

## HARD RULES (NEVER BREAK WITHOUT ESCALATION)

These patterns are non-negotiable without explicit approval:

1. **No `any` types.** Use proper TypeScript.
2. **Validate all external input.** Use Zod.
3. **Never inline secrets.** Use env vars.
4. **Auth checks on protected routes.** Never trust client-side checks.
5. **Use parameterized queries.** Never concatenate SQL.
6. **HttpOnly cookies only.** Never localStorage for tokens.
7. **Server components by default.** Client only when needed.
8. **Sanitize user-generated HTML.** Use DOMPurify.
9. **CSRF protection.** NextAuth handles it; custom routes need it.
10. **Build must pass.** No console errors or TypeScript warnings.

---

## HOW TO USE THIS SKILL

### Quick Reference

For a specific topic, see the **Examples** folder:
- `examples/auth-nextauth.tsx` — NextAuth setup
- `examples/form-validation.tsx` — Zod + form handling
- `examples/api-route-typed.ts` — Typed API route
- `examples/middleware.ts` — Auth middleware
- `examples/database-prisma.ts` — Prisma integration
- `examples/client-query.tsx` — React Query usage
- `examples/error-handling.tsx` — Error boundaries
- `examples/image-optimization.tsx` — Image component

### Templates

For scaffolding new code:
- `templates/new-page.tsx` — Server page template
- `templates/new-api-route.ts` — API route template
- `templates/new-client-component.tsx` — Client component template
- `templates/new-database-model.prisma` — Prisma model

### Patterns Deep-Dive

For detailed explanations and justifications:
- `patterns/server-first-architecture.md` — Why servers by default
- `patterns/type-safety.md` — TypeScript + Zod strategy
- `patterns/security-checklist.md` — Security hardening
- `patterns/performance-optimization.md` — Caching, bundling, Web Vitals
- `patterns/error-handling.md` — Error boundaries, API errors
- `patterns/testing-strategy.md` — Unit, integration, E2E

### Master Reference

For comprehensive guidance on all topics:
- `./nextjs-frontend-master-prompt.md` — Full specification

---

## WHEN YOU NEED TO DEVIATE

**Step 1: Document the pattern you're breaking**
```
Pattern: [cite from this SKILL.md]
Location: [file and line]
```

**Step 2: State the concrete reason**
```
Reason: [specific, measurable problem the pattern causes]
Evidence: [test results, performance metrics, error logs]
```

**Step 3: Propose the override**
```
Override: [what you're doing instead]
Trade-off: [what you're accepting]
Duration: [temporary or permanent]
```

**Step 4: Get approval**
```
Requested approval from: Jon
Status: PENDING / APPROVED / REJECTED
Date: 2026-08-04
```

**Step 5: Document in code**
```typescript
// PATTERN OVERRIDE: [pattern name]
// REASON: [approval details above]
// FILE: [reference to decision log]
```

---

## VERIFICATION ORACLE

All code must pass these checks:

```bash
# Type checking
tsc --noEmit

# Linting
eslint . --ext .ts,.tsx

# Testing
jest --coverage

# Building
next build

# Starting (locally verify no errors)
next start
```

**All must pass before deployment.** No warnings, no errors.

---

## GOVERNANCE

**This skill is living.** Patterns evolve as we learn.

**To propose a change:**
1. Document the issue (what pattern is failing, where)
2. Propose the change
3. Test it in a branch
4. Request approval from Jon
5. Update this SKILL.md if approved

**Current version:** 1.0  
**Last reviewed:** 2026-08-04  
**Next review:** 2026-09-04  

---

## STRUCTURE

This skill folder contains:

```
nextjs-frontend/
├── SKILL.md                    # This file (entry point, governance)
├── examples/                   # Working code samples
├── patterns/                   # Deep-dive pattern explanations
├── templates/                  # Scaffolds for new code
└── README.md                   # Quick start guide
```

**Start here:** This file.  
**Then:** Browse `examples/` for patterns relevant to your task.  
**For details:** See `patterns/` folder or master prompt.  
**To build:** Use `templates/` to scaffold new code.

---

**Next.js Enterprise Fullstack Skill — Built for production, enforced with reasoning.**
