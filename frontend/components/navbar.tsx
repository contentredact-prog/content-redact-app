"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const [session, setSession] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: any, session: any) => setSession(session)
    );

    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <nav
      className={`
        sticky top-0 z-50 w-full flex justify-between items-center
        px-6 py-4 transition-all duration-300
        ${scrolled
          ? "bg-black/90 backdrop-blur-md border-b border-white/5 shadow-[0_1px_20px_rgba(0,0,0,0.5)]"
          : "bg-transparent border-b border-white/5"
        }
      `}
    >
      <Link href="/" className="flex items-center gap-2.5 group">
        <div className="w-7 h-7 rounded bg-gradient-to-br from-red-600 to-red-900 flex items-center justify-center text-[11px] font-black tracking-tight text-white group-hover:from-red-500 group-hover:to-red-800 transition-all">
          CR
        </div>
        <span className="text-[15px] font-bold tracking-[0.08em] text-white/90">
          CONTENT REDACT
        </span>
      </Link>

      <div className="flex gap-5 items-center text-[13px]">
        <Link href="/upgrade" className="text-white/40 hover:text-amber-400 transition-colors font-medium tracking-wide">
          Upgrade
        </Link>

        {!session ? (
          <Link href="/login" className="bg-white text-black px-4 py-1.5 rounded font-semibold text-[13px] hover:bg-white/90 transition-all">
            Login
          </Link>
        ) : (
          <>
            <Link href="/upload" className="text-white/40 hover:text-white transition-colors font-medium">
              Upload
            </Link>
            <Link href="/dashboard" className="text-white/40 hover:text-white transition-colors font-medium">
              Dashboard
            </Link>
            <button onClick={handleLogout} className="text-white/25 hover:text-red-400 transition-colors font-medium cursor-pointer">
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
}