"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation";

export default function Navbar() {
  const [session, setSession] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

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

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setMenuOpen(false);
    router.push("/");
  };

  return (
    <>
      <nav
        className={`
          sticky top-0 z-50 w-full flex justify-between items-center
          px-4 sm:px-6 py-3 sm:py-4 transition-all duration-300
          ${scrolled
            ? "bg-black/90 backdrop-blur-md border-b border-white/5 shadow-[0_1px_20px_rgba(0,0,0,0.5)]"
            : "bg-black border-b border-white/5"
          }
        `}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group shrink-0">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-red-600 to-red-900 flex items-center justify-center text-[11px] font-black tracking-tight text-white group-hover:from-red-500 group-hover:to-red-800 transition-all">
            CR
          </div>
          <span className="text-[14px] sm:text-[15px] font-bold tracking-[0.08em] text-white/90">
            CONTENT REDACT
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex gap-5 items-center text-[13px]">
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

        {/* Mobile hamburger button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px] cursor-pointer"
          aria-label="Toggle menu"
        >
          <span className={`block w-5 h-[2px] bg-white/70 transition-all duration-300 ${menuOpen ? "rotate-45 translate-y-[7px]" : ""}`} />
          <span className={`block w-5 h-[2px] bg-white/70 transition-all duration-300 ${menuOpen ? "opacity-0" : ""}`} />
          <span className={`block w-5 h-[2px] bg-white/70 transition-all duration-300 ${menuOpen ? "-rotate-45 -translate-y-[7px]" : ""}`} />
        </button>
      </nav>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 top-[52px] z-40 bg-black/95 backdrop-blur-md">
          <div className="flex flex-col p-6 gap-2">
            <Link
              href="/upgrade"
              className="py-3 px-4 rounded-lg text-[15px] font-medium text-white/50 hover:text-amber-400 hover:bg-white/[0.03] transition-all"
            >
              Upgrade
            </Link>

            {!session ? (
              <Link
                href="/login"
                className="py-3 px-4 rounded-lg text-[15px] font-medium text-white bg-white/10 hover:bg-white/15 transition-all mt-2 text-center"
              >
                Login
              </Link>
            ) : (
              <>
                <Link
                  href="/upload"
                  className="py-3 px-4 rounded-lg text-[15px] font-medium text-white/50 hover:text-white hover:bg-white/[0.03] transition-all"
                >
                  Upload
                </Link>
                <Link
                  href="/dashboard"
                  className="py-3 px-4 rounded-lg text-[15px] font-medium text-white/50 hover:text-white hover:bg-white/[0.03] transition-all"
                >
                  Dashboard
                </Link>
                <div className="border-t border-white/[0.06] my-3" />
                <button
                  onClick={handleLogout}
                  className="py-3 px-4 rounded-lg text-[15px] font-medium text-red-400/60 hover:text-red-400 hover:bg-red-950/20 transition-all text-left cursor-pointer"
                >
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}