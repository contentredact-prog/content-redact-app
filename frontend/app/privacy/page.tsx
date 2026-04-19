export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-black text-gray-300 p-6 md:p-12 font-sans leading-relaxed">
      <div className="max-w-3xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500">Last Updated: April 2026</p>

        <section>
          <h2 className="text-2xl font-semibold text-white mt-8 mb-4">1. Introduction</h2>
          <p>
            Welcome to Content Redact. We are committed to protecting your personal information and your right to privacy. 
            This policy outlines how we handle your data when you use our web and mobile applications.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mt-8 mb-4">2. Information We Collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Account Information:</strong> We collect your email address and authentication tokens when you sign up using Google, Apple, or email.</li>
            <li><strong>Media Fingerprints:</strong> When you use our service to protect audio or video files, we generate unique digital signatures (fingerprints) of your media. We do not store your raw audio or video files permanently on our servers after the fingerprinting process is complete.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mt-8 mb-4">3. How We Use Your Information</h2>
          <p>We use your digital fingerprints strictly to scan the web and detect unauthorized reuse of your intellectual property. Your account data is used solely to provide you access to your dashboard and alerts.</p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mt-8 mb-4">4. Data Retention and Deletion</h2>
          <p>
            You have complete control over your data. You may request to delete your account at any time via the "Support" page in our app or website. 
            <strong> Upon deletion, all associated account information and media fingerprints are immediately and permanently erased from our active databases.</strong>
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mt-8 mb-4">5. Contact Us</h2>
          <p>If you have questions or comments about this policy, you may email us at:</p>
          <p className="mt-2 text-white font-medium">support@contentredact.com</p>
        </section>
      </div>
    </div>
  );
}