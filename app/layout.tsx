import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://yingyen.com"),
  title: "YingYen Liu · Frontend Engineer",
  description:
    "Frontend engineer building interfaces and the tools that ship them. Plus a lab of WebGPU sketches, from a Tessendorf FFT ocean to 163,840 particles.",
  openGraph: {
    type: "website",
    url: "https://yingyen.com",
    siteName: "YingYen Liu",
    title: "YingYen Liu · Frontend Engineer",
    description:
      "Interfaces, the tools that ship them, and a lab of WebGPU sketches.",
    images: [{ url: "/og.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
