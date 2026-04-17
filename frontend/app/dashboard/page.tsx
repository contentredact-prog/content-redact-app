'use client';

import { useEffect, useState } from 'react';

interface Match {
  url: string;
  platform: string;
  action_status: string;
}

interface ProtectedWork {
  id: string;
  title: string;
  status: string;
  matches_found: number;
  matches: Match[];
}

export default function Dashboard() {
  const [works, setWorks] = useState<ProtectedWork[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  const [dmcaNotice, setDmcaNotice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/v1/works')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setWorks(data);
      })
      .catch(err => console.error("Dashboard fetch error:", err));
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const issueTakedown = async (workId: string, url: string) => {
    setIsGenerating(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/works/${workId}/generate-dmca?infringing_url=${encodeURIComponent(url)}`, {
        method: 'POST'
      });
      const data = await res.json();
      setDmcaNotice(data.notice_text);
    } catch (err) {
      alert("Error generating DMCA notice.");
    }
    setIsGenerating(false);
  };

  // NEW: Function to handle a manual URL input
  const handleManualTakedown = (workId: string) => {
    const manualUrl = prompt("Enter the exact URL of the stolen content you found:");
    if (manualUrl && manualUrl.trim() !== "") {
      issueTakedown(workId, manualUrl);
    }
  };

  const deleteWork = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this record?")) return;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/works/${id}`, { method: 'DELETE' });
      if (res.ok) setWorks(works.filter(w => w.id !== id));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
      
      {/* UPGRADED DMCA MODAL */}
      {dmcaNotice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
              <h2 className="text-xl font-bold text-red-600">Generated DMCA Notice</h2>
              <button onClick={() => setDmcaNotice(null)} className="text-gray-400 hover:text-black font-bold">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50">
              <pre className="whitespace-pre-wrap font-mono text-sm bg-white p-5 rounded-lg border border-gray-200 text-gray-800 shadow-sm">
                {dmcaNotice}
              </pre>

              {/* NEW: Platform Submission Guide */}
              <div className="mt-6 bg-blue-50/50 p-5 rounded-lg border border-blue-100">
                <h3 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>
                  Where to send this notice:
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
                  <div className="bg-white p-3 rounded shadow-sm border border-blue-50">
                    <span className="font-bold block mb-1">YouTube</span>
                    Email: <a href="mailto:copyright@youtube.com" className="text-blue-600 hover:underline">copyright@youtube.com</a><br/>
                    Or use their <a href="https://support.google.com/youtube/answer/2807622" target="_blank" className="text-blue-600 hover:underline">Copyright Webform →</a>
                  </div>
                  <div className="bg-white p-3 rounded shadow-sm border border-blue-50">
                    <span className="font-bold block mb-1">TikTok</span>
                    Email: <a href="mailto:copyright@tiktok.com" className="text-blue-600 hover:underline">copyright@tiktok.com</a><br/>
                    Or use their <a href="https://www.tiktok.com/legal/report/Copyright" target="_blank" className="text-blue-600 hover:underline">Reporting Form →</a>
                  </div>
                  <div className="bg-white p-3 rounded shadow-sm border border-blue-50">
                    <span className="font-bold block mb-1">Instagram & Facebook</span>
                    Email: <a href="mailto:ip@instagram.com" className="text-blue-600 hover:underline">ip@instagram.com</a><br/>
                    Or use their <a href="https://help.instagram.com/contact/552695131608132" target="_blank" className="text-blue-600 hover:underline">IP Webform →</a>
                  </div>
                  <div className="bg-white p-3 rounded shadow-sm border border-blue-50">
                    <span className="font-bold block mb-1">X (Twitter)</span>
                    Email: <a href="mailto:copyright@twitter.com" className="text-blue-600 hover:underline">copyright@twitter.com</a><br/>
                    Or use their <a href="https://help.twitter.com/en/forms/ipi/dmca" target="_blank" className="text-blue-600 hover:underline">DMCA Form →</a>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-white flex justify-end gap-3 shrink-0">
              <button onClick={() => setDmcaNotice(null)} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button 
                onClick={() => {navigator.clipboard.writeText(dmcaNotice); alert("Copied to clipboard!");}} 
                className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-sm transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">Monitoring Dashboard</h1>
        
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-8 rounded-r-lg shadow-sm">
          <div className="flex">
            <div className="flex-shrink-0"><span className="text-amber-500 font-bold">⚠️ Notice:</span></div>
            <div className="ml-3">
              <p className="text-sm text-amber-700 font-medium">
                We do not store your media files. Your protected file will be <strong>permanently deleted from our servers immediately after you download it</strong>. 
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          {works.map((work) => (
            <div key={work.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative group">
              
              <button onClick={() => deleteWork(work.id)} className="absolute top-4 right-4 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100" title="Delete Record">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              </button>

              <div className="p-6 pr-12 flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-lg">{work.title}</h3>
                  <p className="text-xs text-gray-400 font-mono mt-1">ID: {work.id}</p>
                </div>
                
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-bold uppercase mr-2">{work.status}</span>
                  <div className="text-right px-3 border-r border-gray-100">
                    <div className="text-2xl font-bold text-red-500">{work.matches_found}</div>
                    <div className="text-[10px] uppercase text-gray-400 font-bold leading-none">Matches</div>
                  </div>
                  
                  {/* NEW: Manual Takedown Button */}
                  <button 
                    onClick={() => handleManualTakedown(work.id)}
                    className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm hover:bg-red-100 transition-colors font-bold border border-red-100"
                    title="Found a stolen copy yourself? Generate a notice here."
                  >
                    + Manual DMCA
                  </button>

                  <button onClick={() => toggleExpand(work.id)} className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-black transition-colors">
                    {expandedId === work.id ? "Hide Links" : "View Links"}
                  </button>
                  <a href={`http://127.0.0.1:8000/api/v1/works/${work.id}/download`} download className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition-colors font-bold shadow-sm">
                    ↓ Download
                  </a>
                </div>
              </div>

              {expandedId === work.id && (
                <div className="bg-gray-50 border-t border-gray-100 p-6">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">Discovered Matches</h4>
                  <div className="grid gap-3">
                    {work.matches && work.matches.length > 0 ? work.matches.map((match, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border border-gray-200 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-sm text-gray-800 w-20">{match.platform}</span>
                          <a href={match.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-sm truncate max-w-xs">{match.url}</a>
                        </div>
                        <button onClick={() => issueTakedown(work.id, match.url)} className="text-xs bg-red-100 text-red-600 hover:bg-red-200 px-3 py-1.5 rounded font-semibold transition-colors disabled:opacity-50" disabled={isGenerating}>
                          {isGenerating ? "Generating..." : "Issue Takedown"}
                        </button>
                      </div>
                    )) : (
                      <p className="text-sm text-gray-500 italic">No automated matches found yet. Use the "+ Manual DMCA" button if you found one yourself!</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}