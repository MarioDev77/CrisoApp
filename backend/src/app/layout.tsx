import type { ReactNode } from "react";

export const metadata = { title: "CrisoVerde", description: "Recicle e ganhe recompensas" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
