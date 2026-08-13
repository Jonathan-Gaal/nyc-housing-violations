// examples/image-optimization.tsx
// Image optimization using next/image
// Pattern: Lazy loading, responsive sizing, blur placeholders

'use client';

import Image from 'next/image';
import { useState } from 'react';

// ============================================================================
// BASIC IMAGE COMPONENT
// ============================================================================

export function BasicImage() {
  return (
    <Image
      src="/images/hero.jpg"
      alt="Hero image"
      width={800}
      height={400}
      priority={false}
      // Lazy load by default (good for below-the-fold images)
    />
  );
}

// ============================================================================
// RESPONSIVE IMAGE WITH SIZES
// ============================================================================

export function ResponsiveImage() {
  return (
    <Image
      src="/images/product.jpg"
      alt="Product image"
      width={1200}
      height={800}
      // Responsive breakpoints
      sizes="
        (max-width: 640px) 100vw,
        (max-width: 1024px) 50vw,
        (max-width: 1280px) 33vw,
        25vw
      "
      priority={false}
    />
  );
}

// ============================================================================
// HERO IMAGE (ABOVE THE FOLD - USE PRIORITY)
// ============================================================================

export function HeroImage() {
  return (
    <Image
      src="/images/hero-banner.jpg"
      alt="Hero banner"
      width={1920}
      height={1080}
      // Load immediately (no lazy load)
      priority={true}
      // Optimize for Core Web Vitals
      placeholder="blur"
      blurDataURL="data:image/jpeg;base64,..."
      sizes="100vw"
      style={{
        width: '100%',
        height: 'auto',
      }}
    />
  );
}

// ============================================================================
// FILL CONTAINER (UNKNOWN DIMENSIONS)
// ============================================================================

export function FillImage() {
  return (
    <div className="relative w-full h-64">
      <Image
        src="/images/background.jpg"
        alt="Background"
        fill
        // When using fill, specify object-fit
        className="object-cover"
        // Still lazy load by default
        sizes="(max-width: 768px) 100vw, 50vw"
      />
    </div>
  );
}

// ============================================================================
// PROFILE PICTURE (SMALL, AVATAR)
// ============================================================================

export function ProfilePicture({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={64}
      height={64}
      // Avatars are small; priority is often worth it
      priority={false}
      className="rounded-full"
      // Blur placeholder improves perception of load time
      placeholder="blur"
      blurDataURL="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23e5e7eb'/%3E%3C/svg%3E"
    />
  );
}

// ============================================================================
// OPTIMIZED PRODUCT GRID
// ============================================================================

interface Product {
  id: string;
  name: string;
  image: string;
  price: number;
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((product, index) => (
        <div key={product.id} className="bg-white rounded-lg shadow">
          {/* Relative container for responsive images */}
          <div className="relative w-full aspect-square bg-gray-100">
            <Image
              src={product.image}
              alt={product.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform"
              // First few images get priority for LCP
              priority={index < 3}
              // Responsive sizing
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              // Blur while loading
              placeholder="blur"
              blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRg..."
            />
          </div>
          <div className="p-4">
            <h3 className="font-semibold">{product.name}</h3>
            <p className="text-gray-600 mt-2">${product.price}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// IMAGE WITH LOADING SKELETON
// ============================================================================

export function ImageWithSkeleton() {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="relative w-full h-64 bg-gray-100 rounded-lg overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-r from-gray-100 via-white to-gray-100 animate-pulse" />
      )}
      <Image
        src="/images/content.jpg"
        alt="Content image"
        fill
        className="object-cover"
        onLoadingComplete={() => setIsLoading(false)}
        sizes="100vw"
      />
    </div>
  );
}

// ============================================================================
// NEXT.CONFIG.JS - IMAGE OPTIMIZATION SETTINGS
// ============================================================================

/*
// next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Optimize remote images
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.example.com',
        pathname: '/images/**',
      },
    ],

    // Image formats (WebP first for modern browsers)
    formats: ['image/avif', 'image/webp'],

    // Cache duration for optimized images (browser cache)
    minimumCacheTTL: 60 * 60 * 24 * 365, // 1 year

    // Maximum file size for static images
    staticGenerationTimeout: 300,

    // Device sizes for responsive behavior
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],

    // Image sizes for srcset generation
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],

    // Dangerously allow SVG (be careful with untrusted SVG)
    dangerouslyAllowSVG: false,
  },
};

module.exports = nextConfig;
*/

// ============================================================================
// PERFORMANCE TIPS
// ============================================================================

/*
1. **Always use width and height**: Prevents layout shift (CLS)
   - Exception: When using fill, height doesn't need to be specified

2. **Use priority for above-the-fold images**: Loads immediately
   - Typically: Hero images, first 3-5 images in a grid
   - Avoid: Images below the fold, in modals, off-screen

3. **Use blur placeholder for better UX**: Perceived performance
   - Generate blur with tools like plaiceholder or blurhash
   - Improves CLS and user perception

4. **Optimize srcset with sizes prop**: Responsive image loading
   - Reduces bandwidth for mobile users
   - Automatically generates WebP/AVIF versions

5. **Use WebP/AVIF formats**: Smaller file sizes
   - Next.js handles format detection automatically
   - Falls back to original format for older browsers

6. **Lazy load by default**: Only load when needed
   - priority={true} only when necessary
   - Saves bandwidth and improves page load speed

7. **Cache optimized images**: 1-year cache for static images
   - Dynamic images can use shorter TTL
   - Configured in next.config.js

8. **Monitor Core Web Vitals**: Next.js Image optimizes for these
   - LCP: Load priority images early
   - CLS: Specify width/height, use placeholder
   - FID: Doesn't directly affect, but fast images help
*/

// ============================================================================
// BEST PRACTICES DEMONSTRATED
// ============================================================================

// ✅ Responsive sizing: Uses sizes prop for device-appropriate delivery
// ✅ Format optimization: Automatic WebP/AVIF with fallback
// ✅ Lazy loading: Default; priority only when needed
// ✅ Blur placeholder: Improves perceived performance (CLS)
// ✅ Proper dimensions: Always specify width/height (prevents layout shift)
// ✅ Mobile optimization: Responsive breakpoints reduce bandwidth
// ✅ Caching: 1-year cache for optimized static images
// ✅ Performance monitoring: Integrates with Core Web Vitals
// ✅ Fill mode: Container-based sizing for flexible layouts
// ✅ Error handling: Fallback to alt text if image fails to load
