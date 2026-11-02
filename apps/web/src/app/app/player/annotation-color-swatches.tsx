import { ANNOTATION_COLORS } from "./annotation-model";

export function AnnotationColorSwatches({ value, onChange, disabled = false, label = "批注颜色" }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const colors = ANNOTATION_COLORS.includes(value) ? ANNOTATION_COLORS : [value, ...ANNOTATION_COLORS];
  return <div className="mr-player-page__swatches" role="group" aria-label={label}>
    {colors.map((color) => <button
      key={color}
      type="button"
      className={`mr-player-page__swatch${value === color ? " mr-player-page__swatch--active" : ""}`}
      style={{ background: color }}
      aria-label={`${label} ${color}`}
      aria-pressed={value === color}
      title={color}
      disabled={disabled}
      onClick={() => onChange(color)}
    />)}
  </div>;
}
