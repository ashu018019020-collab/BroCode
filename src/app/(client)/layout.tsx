"use client";

import "../globals.css";
import Navbar from "@/components/navbar";
import Providers from "@/components/providers";
import SideMenu from "@/components/sideMenu";
import { cn } from "@/lib/utils";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

const metadata = {
  title: "FoloUp",
  description: " AI-powered Interviews",
  openGraph: {
    title: "FoloUp",
    description: "AI-powered Interviews",
    siteName: "FoloUp",
    images: [
      {
        url: "/foloup.png",
        width: 800,
        height: 600,
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAuthRoute = pathname.includes("/sign-in") || pathname.includes("/sign-up");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>{metadata.title}</title>
        <meta name="description" content={metadata.description} />
        <link rel="icon" href="/browser-client-icon.ico" />
      </head>
      <body className={cn(inter.className, "antialiased overflow-hidden min-h-screen")}>
        <ClerkProvider
          dynamic
          signInFallbackRedirectUrl={"/dashboard"}
          afterSignOutUrl={"/sign-in"}
        >
          <Providers>
            {isAuthRoute ? (
              children
            ) : (
              <>
                <Navbar />
                <div className="flex flex-row h-screen">
                  <SideMenu />
                  <div className="ml-[200px] pt-[64px] h-full overflow-y-auto flex-grow">
                    {children}
                  </div>
                </div>
              </>
            )}
            <Toaster
              toastOptions={{
                classNames: {
                  toast: "bg-white",
                  title: "text-black",
                  description: "text-red-400",
                  actionButton: "bg-indigo-400",
                  cancelButton: "bg-orange-400",
                  closeButton: "bg-white-400",
                },
              }}
            />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
