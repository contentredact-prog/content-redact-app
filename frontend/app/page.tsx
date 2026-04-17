'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  
  // NEW: State to track if the upload is in progress
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleUpload = async () => {
    if (!file) return;
    
    // NEW: Turn on the loading spinner
    setIsUploading(true);
    setResult(null); 
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('owner', 'VIMciety Creator'); 

    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/works/protect', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      alert("Upload failed. Please check your backend terminal.");
    }
    
    // NEW: Turn off the loading spinner
    setIsUploading(false);
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-gray-900 relative">
      <div className="absolute top-4 right-8">
        <Link href="/dashboard" className="text-gray-600 font-bold hover:text-black transition-colors">
          Dashboard →
        </Link>
      </div>

      <div className="bg-white p-10 rounded-2xl shadow-xl max-w-md w-full text-center border border-gray-100">
        <h1 className="text-3xl font-black mb-6 text-gray-800 tracking-tight">Content Redact App</h1>
        
        <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 mb-6 bg-blue-50/50 transition-all hover:bg-blue-50">
          <input 
            type="file" 
            accept="video/mp4,audio/mpeg,audio/wav,audio/mp3" 
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
          />
          <p className="text-xs text-gray-400 mt-4 font-medium uppercase tracking-wider">MP4, MP3, or WAV</p>
        </div>

        {/* NEW: The dynamic loading button */}
        <button 
          onClick={handleUpload}
          disabled={!file || isUploading}
          className="w-full bg-blue-600 text-white px-6 py-3.5 rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-200 flex justify-center items-center gap-2"
        >
          {isUploading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Scanning & Uploading...
            </>
          ) : (
            "Upload & Protect"
          )}
        </button>

        {result && (
          <div className="mt-8 p-5 bg-green-50 border border-green-100 rounded-xl text-left shadow-inner">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <h3 className="text-green-800 font-bold text-sm uppercase tracking-wide">Success!</h3>
            </div>
            <p className="text-sm text-green-700 mb-3">Your content is being securely processed.</p>
            <div className="bg-white/60 p-2 rounded text-xs font-mono text-green-800 break-all border border-green-200/50 mb-4">
              ID: {result.work_id}
            </div>
            <Link 
              href="/dashboard" 
              className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm inline-block text-sm"
            >
              View in Dashboard
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}