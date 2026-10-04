import { useCallback, useEffect, useRef } from 'react';
import { useBeforeUnload } from '../../hooks/useBeforeUnload';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useEditorStore } from '../../store/editorStore';
import { addImageFromFile } from '../../utils/editorActions';
import { isEmbedMode } from '../../utils/embed';
import { ensureFont, preloadFonts } from '../../utils/fonts';
import '../../utils/fabric/setup';
import { FloatingNav } from './FloatingNav';
import { PageViewport } from './PageViewport';
import { PropertiesPanel } from './PropertiesPanel';
import { ThumbnailSidebar } from './ThumbnailSidebar';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

export default function EditorShell() {
  const dirty = useEditorStore((s) => s.dirty);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const pickImage = useCallback(() => imageInputRef.current?.click(), []);
  useKeyboardShortcuts(pickImage);
  // The parent site owns navigation while this editor is iframed.
  useBeforeUnload(dirty && !isEmbedMode());

  useEffect(() => {
    const { style } = useEditorStore.getState();
    void ensureFont(style.fontId, style.bold, style.italic);
    preloadFonts(style.fontId);
  }, []);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-slate-100">
      <TopBar />
      <Toolbar onPickImage={pickImage} />
      <div className="relative flex min-h-0 flex-1">
        <ThumbnailSidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <PageViewport />
          <FloatingNav />
        </div>
        <PropertiesPanel />
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void addImageFromFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
