import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AICount Guard — Invoice Review",
  description:
    "Workspace kiểm tra hóa đơn với bằng chứng và phê duyệt của con người",
};
const themeScript = `try { const saved = localStorage.getItem('aicount_theme'); if (saved === 'light' || saved === 'dark') { document.documentElement.dataset.theme = saved; document.documentElement.style.colorScheme = saved; } else { document.documentElement.removeAttribute('data-theme'); document.documentElement.style.removeProperty('color-scheme'); } } catch (_) {}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
