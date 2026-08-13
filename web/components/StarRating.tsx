import { ratingToStars, starVariants, type StarVariant } from "@/lib/starRating";

const STAR_PATH = "M10 1.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L1.3 7.7l6.1-.6L10 1.5z";

function StarIcon({ variant, className }: { variant: StarVariant; className: string }) {
  if (variant === "full") {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={`${className} text-amber-400`}>
        <path d={STAR_PATH} />
      </svg>
    );
  }
  if (variant === "empty") {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        className={`${className} text-slate-300`}
      >
        <path d={STAR_PATH} />
      </svg>
    );
  }
  // Half: outline star with a clipped, left-half-filled star on top.
  return (
    <span className={`relative inline-block ${className}`}>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        className="absolute inset-0 h-full w-full text-slate-300"
      >
        <path d={STAR_PATH} />
      </svg>
      <span className="absolute inset-0 w-1/2 overflow-hidden">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-full w-full text-amber-400">
          <path d={STAR_PATH} />
        </svg>
      </span>
    </span>
  );
}

export default function StarRating({
  rating,
  size = "sm",
}: {
  rating: number;
  size?: "sm" | "md";
}) {
  const stars = ratingToStars(rating);
  const sizeClass = size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";

  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${stars} out of 5 stars`}>
      {starVariants(stars).map((variant, i) => (
        <StarIcon key={i} variant={variant} className={sizeClass} />
      ))}
    </span>
  );
}
