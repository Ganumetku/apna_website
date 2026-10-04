import clsx from 'clsx';
import {
  ArrowUpRight,
  Eraser,
  FileUp,
  Highlighter,
  ImagePlus,
  Languages,
  PenLine,
  ShieldCheck,
  Smartphone,
  Square,
  Type,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import seo from '../../content/landingSeo.json';
import { Logo } from '../common/Logo';

async function open(file: File) {
  // Loaded on demand so PDF.js isn't part of the landing-page bundle.
  const { openPdfFile } = await import('../../utils/openPdf');
  await openPdfFile(file);
}

export function LandingPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleFiles = useCallback((files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) void open(file);
  }, []);

  // Accept drops anywhere on the window, not just on the drop zone.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      handleFiles(e.dataTransfer?.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-white via-slate-50 to-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5" /> Files never leave your device
        </span>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <section className="pt-8 text-center sm:pt-14">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">Edit PDF Online Free</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 sm:text-lg">
            Add text, images, shapes and highlights to a PDF in your browser. It is free, there is no signup, and the file stays on your
            device.
          </p>

          <div
            className={clsx(
              'mx-auto mt-10 flex max-w-3xl flex-col items-center rounded-3xl border-2 border-dashed px-6 py-12 transition sm:py-16',
              dragging ? 'scale-[1.01] border-brand-500 bg-brand-50' : 'border-slate-300 bg-white/70',
            )}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-3 rounded-xl bg-brand-500 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-brand-500/30 transition hover:bg-brand-600 focus:ring-4 focus:ring-brand-200 focus:outline-none sm:px-12 sm:py-5 sm:text-xl"
            >
              <FileUp className="h-6 w-6" />
              Select PDF file
            </button>
            <p className="mt-4 text-sm text-slate-500">{dragging ? 'Drop your PDF to start editing' : 'or drop PDF here'}</p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Choose a PDF file"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={ShieldCheck} title="Private by design" text="No uploads, no servers. Your PDF is processed entirely on your device." />
          <Feature icon={Zap} title="Fast on big files" text="Pages render lazily as you scroll, so even 1000-page documents stay smooth." />
          <Feature icon={Languages} title="Unicode & Hindi" text="Embedded fonts with full Unicode, including Devanagari (हिन्दी) text." />
          <Feature icon={Smartphone} title="Works everywhere" text="Desktop, tablet or phone — mouse, pen and touch are all supported." />
        </section>

        <section className="mt-12 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:p-8">
          <h2 className="text-lg font-bold text-slate-900">Everything you need to mark up a PDF</h2>
          <ul className="mt-5 grid grid-cols-2 gap-3 text-sm text-slate-700 sm:grid-cols-3 lg:grid-cols-6">
            {[
              [Type, 'Add text'],
              [ImagePlus, 'Add images'],
              [Square, 'Shapes'],
              [ArrowUpRight, 'Lines & arrows'],
              [PenLine, 'Free-draw'],
              [Highlighter, 'Highlight'],
              [Eraser, 'White-out'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Type;
              return (
                <li key={label as string} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                  <I className="h-4 w-4 text-brand-500" /> {label as string}
                </li>
              );
            })}
          </ul>
        </section>

        <LandingArticle />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <nav aria-label="Toolwala" className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-sm text-slate-700 sm:px-6">
          <a className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" href="https://toolwala.co/">
            Toolwala home
          </a>
          <a className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" href="https://toolwala.co/">
            All tools
          </a>
          <a className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" href="https://toolwala.co/privacy-policy/">
            Privacy Policy
          </a>
          <a className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" href="https://toolwala.co/terms/">
            Terms
          </a>
          <a className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" href="https://toolwala.co/contact/">
            Contact
          </a>
        </nav>
        <p className="pb-6 text-center text-xs text-slate-500">Built with PDF.js, Fabric.js and pdf-lib. Runs in your browser.</p>
      </footer>
    </div>
  );
}

const linkClass =
  'font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

function LandingArticle() {
  return (
    <article className="mx-auto mt-16 max-w-3xl space-y-12 text-left text-slate-700">
      <section>
        <h2 className="text-2xl font-bold text-slate-900">{seo.howTo.heading}</h2>
        <p className="mt-3 text-base leading-relaxed">{seo.howTo.lede}</p>
        <ol className="mt-5 list-decimal space-y-4 pl-5">
          {seo.howTo.steps.map((step, index) => (
            <li key={step.name}>
              <h3 className="font-semibold text-slate-900">{step.name}</h3>
              <p className="mt-1 leading-relaxed">
                {index === 3 ? (
                  <>
                    Save the file to your computer when you are done. If you started on{' '}
                    <a className={linkClass} href="https://toolwala.co/">
                      Toolwala
                    </a>
                    , Save &amp; Continue hands the PDF back to that page.
                  </>
                ) : (
                  step.text
                )}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-slate-900">{seo.features.heading}</h2>
        <p className="mt-3 leading-relaxed">{seo.features.lede}</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed">
          {seo.features.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-slate-900">{seo.privacy.heading}</h2>
        {seo.privacy.paragraphs.map((paragraph) =>
          paragraph.endsWith('free tools on Toolwala.') ? (
            <p key={paragraph} className="mt-3 leading-relaxed">
              The same private approach is used for the other{' '}
              <a className={linkClass} href="https://toolwala.co/">
                free tools on Toolwala
              </a>
              .
            </p>
          ) : (
            <p key={paragraph} className="mt-3 leading-relaxed">
              {paragraph}
            </p>
          ),
        )}
      </section>

      <section>
        <h2 className="text-2xl font-bold text-slate-900">{seo.limits.heading}</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed">
          {seo.limits.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-slate-900">{seo.hindi.heading}</h2>
        {seo.hindi.paragraphs.map((paragraph) => (
          <p key={paragraph} className="mt-3 leading-relaxed">
            {paragraph}
          </p>
        ))}
        <p lang="hi" className="mt-3 leading-relaxed text-slate-900">
          {seo.hindi.example}
        </p>
        <p className="mt-3 leading-relaxed">{seo.hindi.after}</p>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-slate-900">{seo.faq.heading}</h2>
        <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
          {seo.faq.items.map((item) => (
            <details key={item.q} className="group py-3">
              <summary className="cursor-pointer font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                {item.q}
              </summary>
              <p className="mt-2 leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </article>
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof Type; title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-500">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
    </div>
  );
}
