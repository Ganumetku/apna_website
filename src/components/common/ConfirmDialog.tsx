import { useEditorStore } from '../../store/editorStore';
import { Button, Modal } from './Modal';

export function ConfirmDialog() {
  const dialog = useEditorStore((s) => s.confirmDialog);
  const close = useEditorStore((s) => s.closeConfirm);

  return (
    <Modal
      open={!!dialog}
      title={dialog?.title ?? ''}
      onClose={() => close(false)}
      footer={
        <>
          <Button onClick={() => close(false)}>{dialog?.cancelLabel ?? 'Cancel'}</Button>
          <Button data-autofocus variant={dialog?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {dialog?.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      {dialog?.message}
    </Modal>
  );
}
