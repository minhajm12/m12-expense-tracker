'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      className="z-[100]"
      toastOptions={{
        style: {
          borderRadius: '0.625rem',
          zIndex: 9999,
        },
      }}
    />
  );
}

export { toast } from 'sonner';
