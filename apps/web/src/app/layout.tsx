import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/lib/auth-context';
import { Toaster } from '@/components/ui/toast';
import { AppLayout } from '@/components/layout/app-layout';

export const metadata: Metadata = {
  title: 'M12 Expense Tracker — Personal Finance & Accounting Platform',
  description:
    'Full-stack personal finance application supporting multi-account banking, double-entry credit card management, budget tracking, and real-time analytics.',
  icons: {
    icon: '/img/logo/m12-expense-favicon.svg',
    shortcut: '/img/logo/m12-expense-favicon.svg',
    apple: '/img/logo/m12-expense-favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/svg+xml" href="/img/logo/m12-expense-favicon.svg" />
        <link rel="shortcut icon" href="/img/logo/m12-expense-favicon.svg" />
        <link rel="apple-touch-icon" href="/img/logo/m12-expense-favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,700&family=Google+Sans+Text:ital,wght@0,400;0,500;0,700;1,400;1,500;1,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <AppLayout>{children}</AppLayout>
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
