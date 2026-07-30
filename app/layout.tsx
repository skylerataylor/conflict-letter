import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "LexFlow — Legal Practice Automation", description: "Matter management and intelligent pleading automation." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
