// examples/client-query.tsx
// React Query for efficient client-side data fetching
// Pattern: React Query hooks, caching, error boundaries
// Reference: SKILL.md "Pattern 7: React Query for Client-Side Data"

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { useState } from 'react';

// ============================================================================
// TYPES
// ============================================================================

interface Post {
  id: string;
  title: string;
  content: string;
  tags: string[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface CreatePostInput {
  title: string;
  content: string;
  tags: string[];
  published: boolean;
}

// ============================================================================
// API CLIENT
// ============================================================================

const postsApi = {
  // Fetch all posts for current user
  fetchPosts: async (
    authorId?: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<{ posts: Post[]; total: number }> => {
    const params = new URLSearchParams();
    if (authorId) params.append('authorId', authorId);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await fetch(`/api/posts?${params}`, {
      // Revalidate after 5 minutes
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch posts');
    }

    const json = (await response.json()) as ApiResponse<{
      posts: Post[];
      total: number;
    }>;

    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }

    return json.data!;
  },

  // Fetch single post
  fetchPost: async (postId: string): Promise<Post> => {
    const response = await fetch(`/api/posts/${postId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch post');
    }

    const json = (await response.json()) as ApiResponse<Post>;

    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }

    return json.data!;
  },

  // Create post
  createPost: async (data: CreatePostInput): Promise<Post> => {
    const response = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to create post');
    }

    const json = (await response.json()) as ApiResponse<Post>;

    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }

    return json.data!;
  },

  // Update post
  updatePost: async (postId: string, data: Partial<CreatePostInput>): Promise<Post> => {
    const response = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to update post');
    }

    const json = (await response.json()) as ApiResponse<Post>;

    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }

    return json.data!;
  },

  // Delete post
  deletePost: async (postId: string): Promise<void> => {
    const response = await fetch(`/api/posts/${postId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete post');
    }
  },
};

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

// Fetch posts list
export function usePosts(
  authorId?: string,
  limit: number = 10,
  offset: number = 0
) {
  return useQuery({
    // Unique key for this query
    queryKey: ['posts', authorId, limit, offset] as const,

    // Query function
    queryFn: () => postsApi.fetchPosts(authorId, limit, offset),

    // Cache for 5 minutes, then revalidate in background
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000, // formerly cacheTime

    // Don't retry on 404
    retry: (failureCount, error: any) => {
      if (error?.status === 404) return false;
      return failureCount < 3;
    },
  });
}

// Fetch single post
export function usePost(postId: string) {
  return useQuery({
    queryKey: ['post', postId] as const,
    queryFn: () => postsApi.fetchPost(postId),
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000,
  });
}

// Create post mutation
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePostInput) => postsApi.createPost(data),

    // Invalidate posts list after successful creation
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },

    // Optimistic update (optional)
    onMutate: async (newPost: CreatePostInput) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['posts'] });

      // Get previous posts
      const previousPosts = queryClient.getQueryData(['posts']);

      // Optimistically update cache
      if (previousPosts) {
        queryClient.setQueryData(['posts'], (old: any) => ({
          ...old,
          posts: [
            {
              id: 'temp-id',
              ...newPost,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...old.posts,
          ],
        }));
      }

      return { previousPosts };
    },

    // Rollback on error
    onError: (error, variables, context: any) => {
      if (context?.previousPosts) {
        queryClient.setQueryData(['posts'], context.previousPosts);
      }
    },
  });
}

// Update post mutation
export function useUpdatePost(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<CreatePostInput>) =>
      postsApi.updatePost(postId, data),

    onSuccess: (updatedPost) => {
      // Update specific post
      queryClient.setQueryData(['post', postId], updatedPost);

      // Invalidate posts list
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}

// Delete post mutation
export function useDeletePost(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => postsApi.deletePost(postId),

    onSuccess: () => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: ['post', postId] });

      // Invalidate posts list
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}

// ============================================================================
// COMPONENT: POSTS LIST
// ============================================================================

export function PostsList({ authorId }: { authorId?: string }) {
  const [page, setPage] = useState(0);
  const limit = 10;
  const offset = page * limit;

  const { data, isLoading, error } = usePosts(authorId, limit, offset);

  if (isLoading) {
    return <div className="text-gray-600">Loading posts...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 p-4 rounded text-red-600">
        Failed to load posts: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-4">
        {data?.posts.map((post) => (
          <li key={post.id} className="border rounded p-4">
            <h3 className="font-semibold text-lg">{post.title}</h3>
            <p className="text-gray-600 text-sm mt-1">
              {new Date(post.createdAt).toLocaleDateString()}
            </p>
          </li>
        ))}
      </ul>

      {/* Pagination */}
      <div className="mt-6 flex gap-4">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Previous
        </button>
        <span className="py-2">Page {page + 1} of {Math.ceil((data?.total || 0) / limit)}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={offset + limit >= (data?.total || 0)}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: CREATE POST
// ============================================================================

export function CreatePostForm() {
  const createPost = useCreatePost();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    createPost.mutate(
      {
        title,
        content,
        tags: [],
        published: false,
      },
      {
        onSuccess: () => {
          setTitle('');
          setContent('');
          alert('Post created!');
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full border rounded px-4 py-2"
        disabled={createPost.isPending}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Content"
        className="w-full border rounded px-4 py-2"
        disabled={createPost.isPending}
      />
      <button
        type="submit"
        disabled={createPost.isPending}
        className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {createPost.isPending ? 'Creating...' : 'Create Post'}
      </button>

      {createPost.error && (
        <p className="text-red-600">
          {createPost.error instanceof Error ? createPost.error.message : 'Error'}
        </p>
      )}
    </form>
  );
}

// ============================================================================
// BEST PRACTICES DEMONSTRATED
// ============================================================================

// ✅ Type safety: Full type inference from API responses
// ✅ Caching: Automatic cache management with staleTime and gcTime
// ✅ Background revalidation: Stale queries revalidate automatically
// ✅ Mutations: Separate hooks for create/update/delete
// ✅ Optimistic updates: UI updates immediately, rolls back on error
// ✅ Error handling: Graceful error states in components
// ✅ Loading states: Show loading indicators during fetches
// ✅ Cache invalidation: Automatically invalidate related queries
// ✅ Pagination: Built-in support for paginated data
// ✅ API client: Centralized API logic, easy to test and maintain
