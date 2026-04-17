import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-12 bg-black text-white">
      {/* HERO */}
      <div className="max-w-4xl w-full text-center mt-24">
        <div className="inline-block mb-6 px-3 py-1 text-[11px] font-semibold tracking-[0.15em] uppercase text-red-400 border border-red-900/50 rounded-full bg-red-950/30">
          AI-Powered Content Protection
        </div>

        <h1 className="text-5xl md:text-6xl font-extrabold mb-6 tracking-tight leading-[1.1]">
          Protect Your Script.{" "}
          <span className="bg-gradient-to-r from-red-500 to-orange-400 bg-clip-text text-transparent">
            Find the Thieves.
          </span>
        </h1>

        <p className="text-lg text-gray-400 mb-10 leading-relaxed max-w-2xl mx-auto">
          Visual copyright tools are easily fooled by a flipped video or a speed change.{" "}
          <strong className="text-white">But thieves almost never change your script.</strong>{" "}
          We use AI to extract your spoken words, then hunt for them across the internet.
        </p>

        <Link href="/login">
          <button className="bg-red-600 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-red-500 transition-all shadow-[0_0_30px_rgba(220,38,38,0.3)] hover:shadow-[0_0_40px_rgba(220,38,38,0.5)]">
            Start Protecting for Free
          </button>
        </Link>
      </div>

      {/* HOW IT WORKS */}
      <div className="max-w-5xl w-full grid md:grid-cols-3 gap-6 mt-32">
        {[
          {
            step: "01",
            title: "AI Transcript Trap",
            desc: "Upload your media. Our AI engine instantly extracts the exact spoken script, creating a text fingerprint that survives any visual manipulation.",
          },
          {
            step: "02",
            title: "Automated Sweeps",
            desc: "Our scanners search TikTok, YouTube, and the open web for unauthorized use of your exact phrasing. Scheduled rescans catch new infringements automatically.",
          },
          {
            step: "03",
            title: "One-Click DMCA",
            desc: "View stolen links in your dashboard and generate legally formatted DMCA takedown notices with a single click. Evidence package included.",
          },
        ].map((item) => (
          <div
            key={item.step}
            className="p-6 border border-white/[0.06] rounded-xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
          >
            <div className="text-[11px] font-bold text-red-500/60 tracking-[0.2em] mb-3">
              STEP {item.step}
            </div>
            <h3 className="text-lg font-bold mb-3 text-white/90 group-hover:text-white transition-colors">
              {item.title}
            </h3>
            <p className="text-[14px] text-gray-500 leading-relaxed">
              {item.desc}
            </p>
          </div>
        ))}
      </div>

      {/* TRUST STRIP */}
      <div className="mt-32 mb-16 text-center">
        <p className="text-[12px] text-white/20 tracking-[0.15em] uppercase mb-4">
          Evidence-grade protection
        </p>
        <div className="flex gap-8 items-center justify-center text-[13px] text-white/30">
          <span>SHA-256 Hashing</span>
          <span className="text-white/10">|</span>
          <span>Audio Fingerprinting</span>
          <span className="text-white/10">|</span>
          <span>AI Transcription</span>
          <span className="text-white/10">|</span>
          <span>Metadata Embedding</span>
        </div>
      </div>
    </main>
  );
}