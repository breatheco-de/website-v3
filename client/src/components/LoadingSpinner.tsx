/** Tiny CSS spinner — avoid importing lucide-react on the public hydrate path. */
export function LoadingSpinner({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <div
      className={`inline-block animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-primary ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
