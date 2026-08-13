// templates/new-client-component.tsx
// Template: Client component with hooks
// Copy this to components/[feature]/[Component].tsx and adapt

'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';

// ============================================================================
// TYPES
// ============================================================================

interface Props {
  // Define component props here
  children?: ReactNode;
  onClose?: () => void;
}

interface State {
  // Define component state here
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MyComponent({ children, onClose }: Props) {
  // ========================================================================
  // STATE
  // ========================================================================

  const [state, setState] = useState<State>({
    isOpen: true,
    isLoading: false,
    error: null,
  });

  // ========================================================================
  // EFFECTS
  // ========================================================================

  // Handle mounting/unmounting
  useEffect(() => {
    console.log('[MyComponent] Mounted');

    return () => {
      console.log('[MyComponent] Unmounted');
    };
  }, []);

  // Handle side effects with dependencies
  useEffect(() => {
    if (!state.isOpen) {
      onClose?.();
    }
  }, [state.isOpen, onClose]);

  // ========================================================================
  // CALLBACKS
  // ========================================================================

  const handleOpen = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      error: null,
    }));
  }, []);

  const handleClose = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  const handleAction = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    try {
      // Perform async operation
      const response = await fetch('/api/something', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Operation failed');
      }

      const data = await response.json();

      // Success
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isOpen: false,
      }));
    } catch (error) {
      // Error
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, []);

  // ========================================================================
  // RENDER
  // ========================================================================

  if (!state.isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Component Title</h2>
          <button
            onClick={handleClose}
            disabled={state.isLoading}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="mb-6">
          {state.error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
              <p className="text-red-600 text-sm">{state.error}</p>
            </div>
          )}

          {children}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleAction}
            disabled={state.isLoading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.isLoading ? 'Loading...' : 'Confirm'}
          </button>
          <button
            onClick={handleClose}
            disabled={state.isLoading}
            className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// BEST PRACTICES DEMONSTRATED
// ============================================================================

// ✅ State management: useState for local state
// ✅ Effects: useEffect with proper dependencies
// ✅ Callbacks: useCallback to memoize functions
// ✅ Error handling: Try/catch with error state
// ✅ Loading states: Show loading indicator
// ✅ Accessibility: aria-label for icon buttons
// ✅ Disabled states: Disable during operations
// ✅ Cleanup: Return cleanup function from useEffect
// ✅ Type safety: TypeScript interfaces for props/state
// ✅ Performance: Memoized callbacks, proper dependencies

// ============================================================================
// USAGE
// ============================================================================

/*
'use client';

import { useState } from 'react';
import { MyComponent } from '@/components/MyComponent';

export default function Page() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setIsOpen(true)}>
        Open Component
      </button>

      <MyComponent
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <p>Component content here</p>
      </MyComponent>
    </div>
  );
}
*/
