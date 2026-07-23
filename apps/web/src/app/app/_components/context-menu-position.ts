type AnchorRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function placeAnchoredMenu(args: {
  anchor: AnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  menuWidth: number;
  menuHeight: number;
  gap?: number;
  margin?: number;
}) {
  const gap = args.gap ?? 8;
  const margin = args.margin ?? 12;
  const maximumX = Math.max(margin, args.viewportWidth - args.menuWidth - margin);
  const maximumY = Math.max(margin, args.viewportHeight - args.menuHeight - margin);
  const belowY = args.anchor.bottom + gap;
  const aboveY = args.anchor.top - args.menuHeight - gap;
  const fitsBelow = belowY + args.menuHeight <= args.viewportHeight - margin;
  const fitsAbove = aboveY >= margin;

  return {
    x: clamp(args.anchor.right - args.menuWidth, margin, maximumX),
    y: fitsBelow ? belowY : fitsAbove ? aboveY : clamp(belowY, margin, maximumY),
    placement: fitsBelow ? "below" as const : fitsAbove ? "above" as const : "viewport" as const
  };
}
