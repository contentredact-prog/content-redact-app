export default function UpgradePage() {
  return (
    <main className="flex min-h-screen flex-col items-center py-24 px-6 bg-black text-white">
      <div className="max-w-6xl w-full text-center">
        
        {/* Header Section */}
        <h1 className="text-5xl font-extrabold mb-6 tracking-tight">Scale Your Content <span className="text-blue-500">Protection.</span></h1>
        <p className="text-xl text-gray-400 mb-16 max-w-2xl mx-auto">
          Start for free, upgrade when you need automated, 24/7 sweeps and high-volume copyright enforcement.
        </p>
        
        {/* Pricing Cards Grid */}
        <div className="grid md:grid-cols-3 gap-8 text-left">
          
          {/* Free Tier */}
          <div className="border border-gray-800 bg-gray-900/40 p-8 rounded-2xl flex flex-col">
            <h3 className="text-2xl font-bold mb-2">Free</h3>
            <p className="text-gray-400 mb-6 flex-grow text-sm">Perfect for testing the engine and securing individual files.</p>
            <div className="text-5xl font-extrabold mb-6">$0<span className="text-lg font-normal text-gray-500">/mo</span></div>
            <ul className="mb-8 space-y-4 text-sm text-gray-300">
              <li className="flex items-center">✓ <span className="ml-2">5 Manual Scans / month</span></li>
              <li className="flex items-center">✓ <span className="ml-2">AI Transcript Fingerprinting</span></li>
              <li className="flex items-center">✓ <span className="ml-2">TikTok Sweeps</span></li>
            </ul>
            <button className="w-full py-3 px-4 bg-gray-800 text-gray-400 font-bold rounded-lg cursor-not-allowed">
              Current Plan
            </button>
          </div>

          {/* Creator Tier */}
          <div className="border-2 border-blue-600 bg-blue-900/10 p-8 rounded-2xl flex flex-col relative transform hover:-translate-y-1 transition-transform">
            <div className="absolute top-0 right-0 bg-blue-600 text-[10px] uppercase font-bold tracking-widest px-3 py-1 rounded-bl-lg rounded-tr-xl">
              Most Popular
            </div>
            <h3 className="text-2xl font-bold mb-2">Creator</h3>
            <p className="text-gray-400 mb-6 flex-grow text-sm">For consistent uploaders who need automated 24/7 protection.</p>
            <div className="text-5xl font-extrabold mb-6">$19<span className="text-lg font-normal text-gray-500">/mo</span></div>
            <ul className="mb-8 space-y-4 text-sm text-gray-300">
              <li className="flex items-center">✓ <span className="ml-2">Unlimited Manual Scans</span></li>
              <li className="flex items-center">✓ <span className="ml-2">24/7 Automated Web Sweeps</span></li>
              <li className="flex items-center text-blue-400 font-semibold">✓ <span className="ml-2">Auto-generated DMCA Notices</span></li>
              <li className="flex items-center">✓ <span className="ml-2">Priority Apify Processing</span></li>
            </ul>
            <button className="w-full py-3 px-4 bg-gray-800 text-gray-500 font-bold rounded-lg border border-gray-700 cursor-not-allowed transition-all">
              Coming Soon
            </button>
          </div>

          {/* Agency Tier */}
          <div className="border border-gray-800 bg-gray-900/40 p-8 rounded-2xl flex flex-col">
            <h3 className="text-2xl font-bold mb-2">Agency</h3>
            <p className="text-gray-400 mb-6 flex-grow text-sm">For management agencies handling multiple creator portfolios.</p>
            <div className="text-5xl font-extrabold mb-6">$99<span className="text-lg font-normal text-gray-500">/mo</span></div>
            <ul className="mb-8 space-y-4 text-sm text-gray-300">
              <li className="flex items-center">✓ <span className="ml-2">Everything in Creator</span></li>
              <li className="flex items-center">✓ <span className="ml-2">Multi-Account Management</span></li>
              <li className="flex items-center">✓ <span className="ml-2">API Access for Bulk Uploads</span></li>
              <li className="flex items-center">✓ <span className="ml-2">White-label Reporting</span></li>
            </ul>
            <button className="w-full py-3 px-4 bg-gray-800 text-gray-500 font-bold rounded-lg border border-gray-700 cursor-not-allowed">
              Coming Soon
            </button>
          </div>

        </div>
      </div>
    </main>
  );
}
