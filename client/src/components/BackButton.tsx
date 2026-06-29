import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { popPreviousInternal } from "@/lib/navHistory";

type BackButtonProps = {
  fallback?: string;
  label?: string;
  className?: string;
};

/**
 * Renders a back button that returns to the previous in-app route.
 *
 * Uses wouter's setLocation (not window.history.back) because in the
 * Perplexity iframe proxy the browser history stack contains entries from
 * the parent shell — calling history.back() can step past our iframe and
 * "kill" the app window. We track our own internal route stack via
 * navHistory and forward-navigate to the previous entry, which is always
 * safe.
 */
export function BackButton({
  fallback = "/",
  label = "Back",
  className,
}: BackButtonProps) {
  const [, setLocation] = useLocation();

  const handleClick = () => {
    const prev = popPreviousInternal();
    setLocation(prev ?? fallback);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className={className}
      data-testid="button-back"
    >
      <ChevronLeft className="h-4 w-4 mr-1" />
      {label}
    </Button>
  );
}

export default BackButton;
