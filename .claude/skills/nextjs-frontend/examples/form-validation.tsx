// examples/form-validation.tsx
// Client form with Zod validation, error handling, loading states
// Pattern: Form validation, server actions, error boundaries
// Reference: SKILL.md "Pattern 2: Zod Validation"

'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useRouter } from 'next/navigation';

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

const CreatePostSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  content: z.string()
    .min(10, 'Content must be at least 10 characters')
    .max(10000, 'Content must be less than 10,000 characters'),
  tags: z.array(z.string())
    .max(5, 'Maximum 5 tags allowed')
    .default([]),
  published: z.boolean().default(false),
});

type CreatePostInput = z.infer<typeof CreatePostSchema>;

// ============================================================================
// FORM COMPONENT
// ============================================================================

interface FormErrors {
  title?: string[];
  content?: string[];
  tags?: string[];
  published?: string[];
  submit?: string;
}

export function CreatePostForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formData, setFormData] = useState<CreatePostInput>({
    title: '',
    content: '',
    tags: [],
    published: false,
  });

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    // Clear error for this field when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[name as keyof FormErrors];
        return updated;
      });
    }
  };

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const tags = e.target.value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    setFormData((prev) => ({
      ...prev,
      tags,
    }));

    if (errors.tags) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated.tags;
        return updated;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    setIsSubmitting(true);

    try {
      // 1. Validate on client
      const parsed = CreatePostSchema.safeParse(formData);

      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors;
        setErrors(fieldErrors);
        setIsSubmitting(false);
        return;
      }

      // 2. Submit to API
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const json = await response.json();

      // 3. Handle API response
      if (!response.ok) {
        if (json.issues) {
          // Server validation failed
          setErrors(json.issues);
        } else {
          // Generic error
          setErrors({ submit: json.error || 'Failed to create post' });
        }
        return;
      }

      // 4. Success
      alert('Post created successfully!');
      router.push(`/posts/${json.data.id}`);
    } catch (error) {
      console.error('[FORM] Submission error:', error);
      setErrors({
        submit: 'An unexpected error occurred. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {/* Title Field */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium mb-2">
          Title *
        </label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={handleInputChange}
          disabled={isSubmitting}
          className={`w-full px-4 py-2 border rounded-lg font-sans ${
            errors.title ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Enter post title"
          required
        />
        {errors.title && (
          <p className="text-red-600 text-sm mt-1">{errors.title[0]}</p>
        )}
      </div>

      {/* Content Field */}
      <div>
        <label htmlFor="content" className="block text-sm font-medium mb-2">
          Content *
        </label>
        <textarea
          id="content"
          name="content"
          value={formData.content}
          onChange={handleInputChange}
          disabled={isSubmitting}
          rows={8}
          className={`w-full px-4 py-2 border rounded-lg font-sans resize-none ${
            errors.content ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Enter post content (min 10 characters)"
          required
        />
        {errors.content && (
          <p className="text-red-600 text-sm mt-1">{errors.content[0]}</p>
        )}
        <p className="text-gray-600 text-sm mt-1">
          {formData.content.length} / 10,000 characters
        </p>
      </div>

      {/* Tags Field */}
      <div>
        <label htmlFor="tags" className="block text-sm font-medium mb-2">
          Tags (comma-separated, max 5)
        </label>
        <input
          type="text"
          id="tags"
          value={formData.tags.join(', ')}
          onChange={handleTagsChange}
          disabled={isSubmitting}
          className={`w-full px-4 py-2 border rounded-lg font-sans ${
            errors.tags ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="e.g., react, nextjs, typescript"
        />
        {errors.tags && (
          <p className="text-red-600 text-sm mt-1">{errors.tags[0]}</p>
        )}
        <p className="text-gray-600 text-sm mt-1">
          {formData.tags.length} / 5 tags
        </p>
      </div>

      {/* Publish Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="published"
          name="published"
          checked={formData.published}
          onChange={handleInputChange}
          disabled={isSubmitting}
          className="w-4 h-4"
        />
        <label htmlFor="published" className="ml-2 text-sm font-medium">
          Publish immediately
        </label>
      </div>

      {/* Submit Error */}
      {errors.submit && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{errors.submit}</p>
        </div>
      )}

      {/* Submit Button */}
      <div className="flex gap-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Creating...' : 'Create Post'}
        </button>
        <button
          type="reset"
          disabled={isSubmitting}
          onClick={() => {
            setFormData({
              title: '',
              content: '',
              tags: [],
              published: false,
            });
            setErrors({});
          }}
          className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// BEST PRACTICES DEMONSTRATED
// ============================================================================

// ✅ Client-side validation: Validate before sending to API
// ✅ Server-side validation: The API also validates (defense in depth)
// ✅ Error handling: Display field-specific and general errors
// ✅ Loading states: Disable form while submitting
// ✅ Clear errors: Remove error when user starts typing
// ✅ Type safety: Use inferred types from Zod schema
// ✅ Character count: Show progress to user
// ✅ Accessibility: Use proper labels and semantic HTML
// ✅ User feedback: Show loading and success states
// ✅ Error recovery: Suggest actions after errors
