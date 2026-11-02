import { IconPhotoPlus, IconX } from "@tabler/icons-react";
import type { ClipboardEvent } from "react";
import { AnnotationColorSwatches } from "./annotation-color-swatches";
import type { AnnotationAttachment } from "./annotation-model";
import { isSubmitKey } from "./player-shortcuts";

type Props = {
  body: string;
  color: string;
  attachments: Array<AnnotationAttachment & { localUrl?: string }>;
  label: string;
  submitLabel: string;
  placeholder?: string;
  busy: boolean;
  uploading: boolean;
  submitting: boolean;
  onBodyChange: (body: string) => void;
  onColorChange: (color: string) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onAddAttachment: () => void;
  onRemoveAttachment: (index: number) => void;
  onPreview: (url: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function AnnotationDraftEditor(props: Props) {
  return <div className="mr-player-page__annotation-editing">
    <textarea
      className="mr-input mr-player-page__annotation-edit-textarea mr-player-page__textarea"
      value={props.body}
      maxLength={5000}
      aria-label={props.label}
      placeholder={props.placeholder}
      disabled={props.busy}
      onChange={(event) => props.onBodyChange(event.target.value)}
      onPaste={props.onPaste}
      onKeyDown={(event) => {
        if (!isSubmitKey(event.nativeEvent)) return;
        event.preventDefault();
        if (!props.busy && !props.uploading) props.onSubmit();
      }}
    />
    {props.attachments.length > 0 ? <div className="mr-player-page__attachment-grid">
      {props.attachments.map((attachment, index) => <figure key={`${attachment.objectKey || attachment.localUrl || index}-${index}`} className="mr-player-page__attachment-card">
        {attachment.previewUrl ? <button type="button" className="mr-player-page__annotation-image-link" disabled={props.busy} onClick={() => props.onPreview(attachment.previewUrl!)}>
          <img className="mr-player-page__attachment-image" src={attachment.previewUrl} alt="批注附件" />
          <span className="mr-player-page__attachment-caption">{attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : "图片"}</span>
        </button> : <div className="mr-player-page__attachment-fallback">图片</div>}
        <button className="mr-player-page__attachment-remove mr-player-page__attachment-remove--floating" type="button" title="移除图片" aria-label="移除图片" disabled={props.busy || props.uploading} onClick={() => props.onRemoveAttachment(index)}><IconX size={16} aria-hidden="true" /></button>
      </figure>)}
    </div> : null}
    <div className="mr-player-page__annotation-edit-tools">
      <AnnotationColorSwatches value={props.color} onChange={props.onColorChange} disabled={props.busy} />
      <div className="mr-player-page__annotation-edit-tools-right">
        <button className="mr-btn" type="button" disabled={props.busy || props.uploading} onClick={props.onAddAttachment}><IconPhotoPlus size={16} aria-hidden="true" />{props.uploading ? "上传图片中…" : "插入图片"}</button>
        <button className="mr-btn" type="button" disabled={props.busy || props.uploading} onClick={props.onCancel}>取消</button>
        <button className="mr-btn mr-btn--primary" type="button" disabled={props.busy || props.uploading || (!props.body.trim() && props.attachments.length === 0)} onClick={props.onSubmit}>{props.submitting ? "保存中…" : props.submitLabel}</button>
      </div>
    </div>
  </div>;
}
