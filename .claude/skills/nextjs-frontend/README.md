# Next.js Enterprise Fullstack Skill

**Production-grade Next.js applications with best practices, security hardening, and performance optimization.**

---

## Quick Start

1. **Read SKILL.md** — Entry point with patterns and governance
2. **Browse examples/** — Working code for each pattern
3. **Use templates/** — Scaffolds for new pages and API routes
4. **Reference master prompt** — `./nextjs-frontend-master-prompt.md`

---

## Folder Structure

```
nextjs-frontend/
├── SKILL.md                    # Entry point (read first)
├── README.md                   # This file
├── examples/                   # Working code samples
│   ├── auth-nextauth.tsx       # NextAuth + Credentials + Prisma
│   ├── api-route-typed.ts      # Type-safe POST/GET with validation
│   ├── form-validation.tsx     # Zod + client form + error handling
│   ├── middleware.ts           # Auth middleware + logging
│   ├── client-query.tsx        # React Query with mutations
│   ├── database-prisma.prisma  # Database schema + queries
│   ├── error-handling.tsx      # Error boundaries + server errors
│   └── image-optimization.tsx  # next/image + performance
└── templates/                  # Scaffolds for new code
    ├── new-page.tsx            # Server page template
    ├── new-api-route.ts        # API route template
    ├── new-client-component.tsx # Client component template
    └── new-database-model.prisma # Database model template
```

---

## Core Patterns

### 1. Server Components by Default

**Pages and layouts are server components.** Use client components only when needed.

```typescript
// ✅ Server component (default)
export default async function Page() {
  const data = await db.query();
  return <View data={data} />;
}

// ❌ Wrong: Unnecessary client component
'use client';
export default function Page() {
  const [data, setData] = useState(null);
  useEffect(() => { /* fetch */ }, []);
  return <View data={data} />;
}
```

**Use client when:**
- User interactions (forms, buttons, clicks)
- React hooks (useState, useEffect)
- Browser APIs (localStorage, geolocation)
- Real-time updates (WebSocket)

---

### 2. Zod Validation for All External Input

Every API input, form submission, and URL parameter must be validated.

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = UserSchema.safeParse(body);
  
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  
  // Use validated data
}
```

---

### 3. HttpOnly Cookies for Auth

Session tokens must be stored in HttpOnly cookies, never localStorage.

```typescript
// ✅ Correct: NextAuth with HttpOnly cookies
export const { auth, signIn, signOut } = NextAuth({
  providers: [Credentials({...})],
  session: { strategy: 'jwt' }, // HttpOnly by default
});

// ❌ Wrong: Storing in localStorage
localStorage.setItem('token', jwt); // VULNERABLE TO XSS
```

---

### 4. TypeScript Strict Mode

No `any` types. Use proper TypeScript.

```typescript
// ✅ Correct
function User({ id, name }: { id: string; name: string }) {
  return <div>{name}</div>;
}

// ❌ Wrong
function User(props: any) {
  return <div>{props.name}</div>;
}
```

---

### 5. React Query for Client Data

Use React Query for efficient client-side data fetching.

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';

export function Users() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then(r => r.json()),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
  if (isLoading) return <Skeleton />;
  if (error) return <Error />;
  return <UserList users={data} />;
}
```

---

### 6. Middleware for Auth & Logging

Use middleware for authentication, redirects, and cross-cutting concerns.

```typescript
// middleware.ts
export async function middleware(request: NextRequest) {
  const session = await auth();
  
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};
```

---

### 7. Parameterized Queries

Never concatenate strings into SQL. Use parameterized queries (ORMs do this automatically).

```typescript
// ✅ Correct: Prisma handles parameterization
const user = await db.user.findUnique({
  where: { email: userInput },
});

// ❌ Wrong: String concatenation
const user = await db.$queryRaw(`
  SELECT * FROM users WHERE email = '${userInput}'
`);
```

---

### 8. Tailwind for Styling

Use Tailwind utility classes. Avoid inline styles and styled-components.

```typescript
// ✅ Tailwind
<button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
  Click me
</button>

// ❌ Inline styles
<button style={{ padding: '8px 16px', backgroundColor: 'blue' }}>
  Click me
</button>
```

---

### 9. Error Boundaries

Wrap components with error boundaries for graceful error handling.

```typescript
'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function Layout() {
  return (
    <ErrorBoundary fallback={<ErrorPage />}>
      <AppContent />
    </ErrorBoundary>
  );
}
```

---

### 10. Image Optimization

Always use `next/image` for optimized images.

```typescript
import Image from 'next/image';

<Image
  src="/hero.jpg"
  alt="Hero"
  width={1200}
  height={600}
  priority={true}      // For above-the-fold
  placeholder="blur"   // Better UX
  sizes="100vw"        // Responsive
/>
```

---

## Development Workflow

### 1. Create a new page

```bash
cp templates/new-page.tsx app/my-route/page.tsx
# Edit with your logic
```

### 2. Create an API route

```bash
cp templates/new-api-route.ts app/api/my-endpoint/route.ts
# Edit with your handlers
```

### 3. Create a client component

```bash
cp templates/new-client-component.tsx components/MyComponent.tsx
# Edit with your component
```

### 4. Create a database model

```bash
cp templates/new-database-model.prisma schema.prisma
# (Append to existing schema)
npx prisma migrate dev --name add_my_model
```

---

## Hard Rules (Never Break Without Approval)

1. **No `any` types** — Use proper TypeScript
2. **Validate all external input** — Use Zod
3. **Never inline secrets** — Use env vars
4. **Auth checks on protected routes** — Never trust client
5. **Use parameterized queries** — Never concatenate SQL
6. **HttpOnly cookies only** — Never localStorage for tokens
7. **Server components by default** — Client only when needed
8. **Sanitize user HTML** — Use DOMPurify
9. **CSRF protection** — NextAuth handles it
10. **Build must pass** — No TypeScript errors or console warnings

---

## When to Deviate

**Deviations are allowed if:**

1. You have measured evidence the pattern causes a problem
2. You have a specific, concrete reason to deviate
3. You have run this reasoning by the human for approval
4. You document the override in your code

**Example:**

```typescript
// PATTERN OVERRIDE: Server component constraint
// REASON: Dashboard needs real-time updates via WebSocket
// APPROVED: 2026-08-04
// SEE: docs/decisions/websocket-override.md
'use client';

export function Dashboard() {
  // Real-time code
}
```

---

## Performance Targets

- **LCP** (Largest Contentful Paint): < 2.5s
- **FID** (First Input Delay): < 100ms
- **CLS** (Cumulative Layout Shift): < 0.1
- **TypeScript build**: < 30s
- **Next.js build**: < 60s

Monitor with:
```bash
npm run lighthouse -- https://staging.example.com
```

---

## Testing Strategy

- **Unit tests** — Jest + React Testing Library (80%+ coverage for critical paths)
- **Integration tests** — API route testing
- **E2E tests** — Playwright for user flows
- **Type checking** — `tsc --noEmit`
- **Linting** — ESLint

```bash
npm run test              # Run tests
npm run test:coverage     # Coverage report
npm run type-check        # TypeScript check
npm run lint              # ESLint
```

---

## Security Checklist

- [ ] No hardcoded secrets in code
- [ ] All external input validated with Zod
- [ ] Auth checks on protected routes (server-side)
- [ ] CSRF protection enabled
- [ ] Parameterized queries (no SQL injection)
- [ ] User-generated HTML sanitized (DOMPurify)
- [ ] Dependencies audited (`npm audit`)
- [ ] Environment variables documented
- [ ] Error messages don't leak info (production)
- [ ] Rate limiting on API routes

---

## Deployment Checklist

- [ ] All tests passing
- [ ] TypeScript `strict: true`, no errors
- [ ] Build succeeds (`next build`)
- [ ] Environment variables set
- [ ] Database migrations run
- [ ] E2E tests pass on staging
- [ ] Security audit passed
- [ ] Performance targets met
- [ ] No console warnings or errors
- [ ] Human approval obtained

---

## Key Files

**Master Reference:** `./nextjs-frontend-master-prompt.md`  
**Skills Entry:** `SKILL.md` (this folder)  
**Examples:** `examples/` (working code)  
**Templates:** `templates/` (scaffolds)

---

## Governance

**Patterns are enforced** unless broken with reasoning and approval.

**When deviating:**
1. State the pattern you're breaking
2. Explain why (with evidence)
3. Get approval from Jon
4. Document in code

**Questions?** See SKILL.md or check examples for working implementations.

---

**Version:** 1.0  
**Last Updated:** 2026-08-04  
**Status:** Active Reference
