import type { CSSProperties } from "react";

type IconProps = {
  size?: number;
  style?: CSSProperties;
};

function base(size: number): CSSProperties {
  return {
    width: size,
    height: size,
    display: "inline-block",
    verticalAlign: "middle"
  };
}

export function IconGrid({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v7h-7z" />
      <path d="M4 13h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
    </svg>
  );
}

export function IconList({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3.5 6h.5" />
      <path d="M3.5 12h.5" />
      <path d="M3.5 18h.5" />
    </svg>
  );
}

export function IconSearch({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
      <path d="M16.5 16.5 21 21" />
    </svg>
  );
}

export function IconSun({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
      <path d="M12 1.8v2.4" />
      <path d="M12 19.8v2.4" />
      <path d="M4.2 12H1.8" />
      <path d="M22.2 12h-2.4" />
      <path d="M5.2 5.2 3.5 3.5" />
      <path d="M20.5 20.5 18.8 18.8" />
      <path d="M18.8 5.2 20.5 3.5" />
      <path d="M3.5 20.5 5.2 18.8" />
    </svg>
  );
}

export function IconMoon({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 14.2A8.5 8.5 0 0 1 9.8 3a7.2 7.2 0 1 0 11.2 11.2z" />
    </svg>
  );
}

export function IconInfo({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.75 6.75a2 2 0 0 1 2-2h10.5a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2z" />
      <path d="M12 10.25v5.25" />
      <path d="M12 7.8h.01" />
    </svg>
  );
}

export function IconSettings({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 7.25h6" />
      <path d="M15.5 7.25h4" />
      <path d="M13 7.25a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
      <path d="M4.5 12h10" />
      <path d="M17.5 12h2" />
      <path d="M19 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
      <path d="M4.5 16.75h3" />
      <path d="M12.5 16.75h7" />
      <path d="M10 16.75a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
    </svg>
  );
}

export function IconVideo({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="6" width="12.5" height="12" rx="2.5" />
      <path d="m16 10 4.5-2.8v9.6L16 14" />
    </svg>
  );
}

export function IconFolder({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3.5 7.5h6l2 2h9c.6 0 1 .4 1 1v9c0 .6-.4 1-1 1h-17c-.6 0-1-.4-1-1v-11c0-.6.4-1 1-1z" />
    </svg>
  );
}

export function IconChevron({
  size = 18,
  style,
  dir = "right" as "right" | "down"
}: IconProps & { dir?: "right" | "down" }) {
  const st = style as CSSProperties | undefined;
  const s = base(size);
  const rot = dir === "down" ? "rotate(90deg)" : "rotate(0deg)";
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ ...s, ...st, transform: `${rot} ${st?.transform ?? ""}`.trim() }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function IconUpload({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function IconPlus({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconSort({ size = 18, style }: IconProps) {
  const s = base(size);
  return (
    <svg viewBox="0 0 24 24" style={{ ...s, ...style }} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 6h14" />
      <path d="M7 12h10" />
      <path d="M7 18h6" />
      <path d="M3 7l2-2 2 2" />
      <path d="M5 5v14" />
    </svg>
  );
}
