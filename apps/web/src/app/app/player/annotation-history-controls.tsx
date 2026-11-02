import { IconArrowBackUp, IconArrowForwardUp } from "@tabler/icons-react";

export function AnnotationHistoryControls({ canUndo, canRedo, busy, readOnly, unavailable, onUndo, onRedo }: {
  canUndo: boolean; canRedo: boolean; busy: boolean; readOnly: boolean; unavailable: boolean; onUndo: () => void; onRedo: () => void;
}) {
  return <div className="mr-player-review-history" role="group" aria-label="批注历史">
    <button type="button" className="mr-player-page__icon-btn" title="撤销批注操作" aria-label="撤销批注操作" disabled={readOnly || busy || !canUndo} onClick={onUndo}><IconArrowBackUp size={18} stroke={1.75} aria-hidden="true" /></button>
    <button type="button" className="mr-player-page__icon-btn" title="重做批注操作" aria-label="重做批注操作" disabled={readOnly || busy || !canRedo} onClick={onRedo}><IconArrowForwardUp size={18} stroke={1.75} aria-hidden="true" /></button>
    {readOnly ? <span className="mr-player-review-status">仅查看</span> : unavailable ? <span className="mr-player-review-status" role="status">服务器暂不支持撤销</span> : null}
  </div>;
}
