import type { Metadata } from "next";
import { Sarabun, Prompt } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/auth-context";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { SetupBanner } from "@/components/setup-banner";

const sarabun = Sarabun({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-sarabun",
});

const prompt = Prompt({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-prompt",
});

export const metadata: Metadata = {
  title: "ระบบติดตามภาระงานการส่งแผนการจัดการเรียนรู้และบันทึกหลังสอน - รร.วัดโป่งแรด",
  description: "ระบบติดตามภาระงานการส่งแผนการจัดการเรียนรู้และบันทึกหลังสอน โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${sarabun.variable} ${prompt.variable}`}>
      <body className="font-sans antialiased min-h-screen flex flex-col justify-between">
        <AuthProvider>
          <SetupBanner />
          <Navbar />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
