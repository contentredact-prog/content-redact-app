"use client";
import { useState } from "react";

export default function SupportPage() {
  const [showModal, setShowModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    // Here you will call your Supabase Edge Function or API route
    // await fetch('/api/delete-user', { method: 'POST' });
    
    alert("Account successfully deleted. You will now be logged out.");
    setShowModal(false);
    setIsDeleting(false);
    // Redirect to home or trigger logout
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 font-sans">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Content Redact Support</h1>

        <section className="mb-12 space-y-4 text-gray-300">
          <h2 className="text-2xl font-semibold text-white">How can we help?</h2>
          <p>
            If you are experiencing issues with audio/video fingerprinting, or need
            help managing your protected assets, our team is here for you.
          </p>
          <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800">
            <h3 className="font-bold text-white mb-2">Contact Us</h3>
            <p>Email: support@contentredact.com</p>
            <p className="text-sm mt-2 text-gray-500">
              We aim to respond to all inquiries within 24-48 hours.
            </p>
          </div>
        </section>

        {/* ACCOUNT MANAGEMENT SECTION */}
        <section className="mt-16 pt-8 border-t border-red-900/30">
          <h2 className="text-2xl font-semibold text-red-500 mb-4">
            Danger Zone
          </h2>
          <p className="text-gray-400 mb-6 text-sm">
            If you no longer wish to use Content Redact, you can permanently
            delete your account. This action cannot be reversed.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-red-900 hover:bg-red-800 text-white px-6 py-3 rounded-md font-semibold transition-colors"
          >
            Delete My Account
          </button>
        </section>

        {/* DELETION WARNING MODAL */}
        {showModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-neutral-900 border border-red-900 p-8 rounded-xl max-w-md w-full shadow-2xl">
              <h3 className="text-2xl font-bold text-white mb-4">
                Are you absolutely sure?
              </h3>
              <p className="text-gray-300 mb-6">
                If you proceed, your account and <strong className="text-white">all of your information, digital fingerprints, and history will be deleted immediately.</strong> 
                {"\n\n"}You will not be capable of accessing it again.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-end">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-5 py-3 rounded-md font-semibold bg-neutral-800 text-white hover:bg-neutral-700 transition-colors"
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  className="px-5 py-3 rounded-md font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center justify-center"
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Permanently Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}