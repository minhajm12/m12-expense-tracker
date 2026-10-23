'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        style: {
          borderRadius: '0.625rem',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
