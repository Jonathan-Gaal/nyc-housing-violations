// examples/auth-nextauth.tsx
// NextAuth.js setup with Credentials provider and database integration
// Pattern: HttpOnly cookies, server-side session validation
// Reference: SKILL.md "Pattern 3: HttpOnly Cookies for Auth"

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { db } from '@/lib/db';

// Validation schema
const CredentialsSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type CredentialsInput = z.infer<typeof CredentialsSchema>;

// NextAuth configuration
export const { auth, signIn, signOut, handlers } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        try {
          // Validate input
          const parsed = CredentialsSchema.safeParse(credentials);
          if (!parsed.success) {
            throw new Error('Invalid credentials format');
          }

          // Find user in database
          const user = await db.user.findUnique({
            where: { email: parsed.data.email },
          });

          if (!user) {
            throw new Error('User not found');
          }

          // Verify password
          const isPasswordValid = await bcrypt.compare(
            parsed.data.password,
            user.passwordHash
          );

          if (!isPasswordValid) {
            throw new Error('Invalid password');
          }

          // Return user object (data available in JWT callback)
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            image: user.avatar,
          };
        } catch (error) {
          console.error('[AUTH] Authorization failed:', error);
          return null;
        }
      },
    }),
  ],

  // Session strategy: JWT (encrypted, HttpOnly cookie)
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // Refresh every 24 hours
  },

  // JWT configuration
  jwt: {
    maxAge: 30 * 24 * 60 * 60, // 30 days
    encryption: true, // Encrypt JWT
  },

  // Callbacks to customize token and session
  callbacks: {
    // Called when JWT is created or updated
    jwt: async ({ token, user, trigger, session }) => {
      // Initial sign in
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.email = user.email;
      }

      // Session update (e.g., user changes their role)
      if (trigger === 'update' && session?.user) {
        token.role = session.user.role;
      }

      return token;
    },

    // Called when session is accessed
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },

    // Called when user authorizes
    authorized: async ({ request, auth }) => {
      // For protected routes, check if user is authenticated
      const isLoggedIn = !!auth?.user;

      const protectedPaths = ['/dashboard', '/admin', '/profile'];
      const isProtectedPath = protectedPaths.some((path) =>
        request.nextUrl.pathname.startsWith(path)
      );

      if (isProtectedPath && !isLoggedIn) {
        return false; // Redirect to login
      }

      return true;
    },
  },

  // Pages
  pages: {
    signIn: '/auth/login',
    error: '/auth/error',
  },

  // Events
  events: {
    signIn: async ({ user, isNewUser }) => {
      console.log(`[AUTH] User ${user.email} signed in`, {
        isNewUser,
        timestamp: new Date().toISOString(),
      });
    },
    signOut: async ({ token }) => {
      console.log(`[AUTH] User signed out`, {
        timestamp: new Date().toISOString(),
      });
    },
  },

  // Debugging (disable in production)
  debug: process.env.NODE_ENV === 'development',
});

// Export auth for use in middleware, server components, etc.
export default handlers;

// Type augmentation for type safety
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: 'user' | 'admin';
      image?: string;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    role: 'user' | 'admin';
    avatar?: string;
  }

  interface JWT {
    id: string;
    email: string;
    role: 'user' | 'admin';
  }
}
