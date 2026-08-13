// examples/error-handling.tsx
// Client error boundary and server error handling
// Pattern: Error boundaries, graceful degradation, user feedback

// ============================================================================
// ERROR BOUNDARY (Client Component)
// ============================================================================

'use client';

import { ReactNode, ReactError } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to error tracking service
    console.error('[ERROR BOUNDARY]', error, errorInfo);

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        this.props.fallback?.(this.state.error, this.resetError) || (
          <DefaultErrorFallback
            error={this.state.error}
            onReset={this.resetError}
          />
        )
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// DEFAULT ERROR FALLBACK
// ============================================================================

function DefaultErrorFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-red-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md p-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Something went wrong
        </h1>
        <p className="text-gray-600 mb-6">
          {process.env.NODE_ENV === 'development'
            ? error.message
            : 'An unexpected error occurred. Please try again.'}
        </p>

        {process.env.NODE_ENV === 'development' && (
          <details className="mb-6 bg-gray-100 p-4 rounded text-left">
            <summary className="cursor-pointer font-mono text-sm">
              Error details
            </summary>
            <pre className="mt-2 text-xs overflow-auto whitespace-pre-wrap">
              {error.stack}
            </pre>
          </details>
        )}

        <button
          onClick={onReset}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// USAGE: WRAP COMPONENTS
// ============================================================================

/*
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html>
      <body>
        <ErrorBoundary
          onError={(error, errorInfo) => {
            // Send to error tracking service (Sentry, etc.)
            console.error('Error:', error, errorInfo);
          }}
          fallback={(error, reset) => (
            <div className="p-4 bg-red-100 border border-red-400 rounded">
              <p className="text-red-700 font-semibold">Failed to load</p>
              <button
                onClick={reset}
                className="mt-2 px-4 py-2 bg-red-600 text-white rounded"
              >
                Retry
              </button>
            </div>
          )}
        >
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
*/

// ============================================================================
// SERVER ERROR HANDLING
// ============================================================================

/*
// app/api/posts/route.ts

export async function POST(request: Request) {
  try {
    // ...
  } catch (error) {
    // Log error for debugging
    console.error('[API] POST /posts failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });

    // Return user-friendly error response
    return Response.json(
      {
        success: false,
        error: 'Failed to create post. Please try again later.',
      },
      { status: 500 }
    );
  }
}

// app/error.tsx (Next.js error page)

'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to service
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Something went wrong!</h1>
        <button
          onClick={() => reset()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// app/not-found.tsx (404 page)

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900">404</h1>
        <p className="text-2xl text-gray-600 mt-4">Page not found</p>
      </div>
    </div>
  );
}
*/

// ============================================================================
// BEST PRACTICES DEMONSTRATED
// ============================================================================

// ✅ Error boundaries: Catch and recover from render errors
// ✅ Graceful fallback: User-friendly error messages
// ✅ Error logging: Detailed logs for debugging in development
// ✅ Error reporting: Send errors to monitoring service
// ✅ Recovery UI: "Try again" button to retry failed operations
// ✅ Environment-specific: Show details in dev, hide in production
// ✅ Proper HTTP status: Return 5xx for server errors, 4xx for client
// ✅ Structured logging: Timestamp, stack trace, context
// ✅ User communication: Clear, actionable error messages
// ✅ Type safety: TypeScript types for error handling
