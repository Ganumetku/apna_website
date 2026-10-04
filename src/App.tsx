import { Suspense, lazy } from 'react';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { LoadingOverlay } from './components/common/LoadingOverlay';
import { PasswordDialog } from './components/common/PasswordDialog';
import { Spinner } from './components/common/Spinner';
import { Toasts } from './components/common/Toasts';
import { LandingPage } from './components/landing/LandingPage';
import { useParentBridge } from './hooks/useParentBridge';
import { useEditorStore } from './store/editorStore';
import { isEmbedMode } from './utils/embed';

// The editor (Fabric, pdf-lib, fonts) is code-split so the landing page loads instantly.
const EditorShell = lazy(() => import('./components/editor/EditorShell'));

export default function App() {
  const hasDoc = useEditorStore((s) => s.doc !== null);
  const embed = isEmbedMode();
  useParentBridge();

  return (
    <>
      {hasDoc ? (
        <Suspense
          fallback={
            <div className="flex h-dvh w-full items-center justify-center">
              <Spinner label="Loading editor…" />
            </div>
          }
        >
          <EditorShell />
        </Suspense>
      ) : embed ? (
        <div className="flex h-dvh w-full items-center justify-center bg-slate-100">
          <Spinner label="Waiting for file..." />
        </div>
      ) : (
        <LandingPage />
      )}
      <LoadingOverlay />
      <ConfirmDialog />
      <PasswordDialog />
      <Toasts />
    </>
  );
}
