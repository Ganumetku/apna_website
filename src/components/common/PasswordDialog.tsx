import { Eye, EyeOff, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Button, Modal } from './Modal';

export function PasswordDialog() {
  const prompt = useEditorStore((s) => s.passwordPrompt);
  const close = useEditorStore((s) => s.closePasswordPrompt);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (prompt) setValue('');
  }, [prompt]);

  const submit = () => {
    if (value) close(value);
  };

  return (
    <Modal
      open={!!prompt}
      title="This PDF is password-protected"
      onClose={() => close(null)}
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!value}>
            <Lock className="h-4 w-4" /> Unlock
          </Button>
        </>
      }
    >
      <p>
        Enter the password to open <span className="font-medium text-slate-800">{prompt?.fileName}</span>. The password never leaves
        your device.
      </p>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`w-full rounded-lg border px-3 py-2.5 pr-10 text-slate-900 outline-none focus:ring-2 ${
              prompt?.incorrect ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100'
            }`}
            placeholder="Password"
            aria-invalid={prompt?.incorrect}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {prompt?.incorrect && <p className="mt-2 text-sm font-medium text-red-600">Incorrect password, please try again.</p>}
      </form>
    </Modal>
  );
}
