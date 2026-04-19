"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // Grab the hash fragment (contains access_token, refresh_token)
    const hash = window.location.hash;

    // Check if this was opened from the mobile app
    // by looking for the mobile redirect in localStorage or a query param
    const isMobile = /expo|contentredact/i.test(document.referrer) ||
                     /mobile|android|iphone/i.test(navigator.userAgent);

    if (isMobile && hash) {
      // Redirect to the Expo app with the tokens
      const expoUrl = `contentredact://auth/callback${hash}`;
      window.location.href = expoUrl;
      return;
    }

    // Web flow — just go to dashboard (Supabase JS client picks up tokens from hash automatically)
    router.replace("/dashboard");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white/30 text-sm">
      Completing sign in...
    </div>
  );
}