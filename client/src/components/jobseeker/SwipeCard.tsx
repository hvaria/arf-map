// SwipeCard — generic horizontal-swipe wrapper for stacked card UIs.
//
// First consumer: WalkthroughPage (3-card onboarding intro) where both
// directions advance the deck. Future consumer: the Phase 2 matches feed
// where left/right encode skip vs. like. The component itself is
// direction-agnostic — it just reports which way the user swiped.
import { type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { cn } from "@/lib/utils";

interface SwipeCardProps {
  children: ReactNode;
  /** Fires once when a swipe commits past the displacement/velocity threshold. */
  onSwipe(direction: "left" | "right"): void;
  /** When true, drag is ignored — useful for the inactive cards in a stack. */
  disabled?: boolean;
  className?: string;
}

// Commit threshold — either a long enough drag OR a fast flick.
// Numbers chosen by the architect spec; do not tune locally.
const COMMIT_DISTANCE = 120;
const COMMIT_VELOCITY = 400;

/**
 * Drag is horizontal-only with elastic resistance so vertical scrolls in
 * the underlying page are NOT swallowed. `touch-action: pan-y` on the
 * root gives mobile browsers permission to scroll vertically while we
 * own horizontal gestures.
 */
export function SwipeCard({
  children,
  onSwipe,
  disabled = false,
  className,
}: SwipeCardProps) {
  const x = useMotionValue(0);

  // Rotate proportional to drag distance for the classic Tinder-style tilt.
  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15]);
  // Fade out toward the edges so cards "leave the deck" gracefully.
  const opacity = useTransform(
    x,
    [-300, -150, 0, 150, 300],
    [0, 1, 1, 1, 0],
  );

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (disabled) return;
    const committed =
      Math.abs(info.offset.x) > COMMIT_DISTANCE ||
      Math.abs(info.velocity.x) > COMMIT_VELOCITY;
    if (committed) {
      onSwipe(info.offset.x > 0 ? "right" : "left");
    }
    // If not committed, framer-motion's animate-back-to-origin via the
    // `style={{ x }}` motion value + spring transition handles the snap.
  };

  return (
    <motion.div
      drag={disabled ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      animate={{ x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      style={{ x, rotate, opacity, touchAction: "pan-y" }}
      className={cn("cursor-grab active:cursor-grabbing select-none", className)}
    >
      {children}
    </motion.div>
  );
}

export default SwipeCard;
